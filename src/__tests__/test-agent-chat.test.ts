import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketServer, type WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";

import { registerTestTools } from "../tools/test.js";

// ── Local WS server harness ──────────────────────────────────────────────
//
// Spinning up a real `ws` server gives the runner an honest wire to talk
// to — same JSON frames, same close codes, same handshake — without
// touching apprunner. Each test gets its own server on an ephemeral
// port so they can run in parallel.

interface Harness {
  url: string;
  server: WebSocketServer;
  setHandler: (handler: (sock: WS) => void) => void;
  close: () => Promise<void>;
}

async function startServer(): Promise<Harness> {
  let handler: (sock: WS) => void = () => {
    /* default: do nothing */
  };

  const server = new WebSocketServer({ port: 0 });

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${addr.port}/ws/voice`;

  server.on("connection", (sock) => handler(sock));

  return {
    url,
    server,
    setHandler: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of server.clients) {
          try {
            client.terminate();
          } catch {
            // best effort
          }
        }
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// ── Mock MCP server (matches the shape used in tools.test.ts) ────────────

interface RegisteredTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: any) => Promise<any>;
}

function createMockServer() {
  const tools: RegisteredTool[] = [];
  return {
    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (params: any) => Promise<any>,
    ) {
      tools.push({ name, description, schema, handler });
    },
    getTool(name: string): RegisteredTool | undefined {
      return tools.find((t) => t.name === name);
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("test_agent_chat MCP tool", () => {
  let harness: Harness;
  let createTestCallToken: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    harness = await startServer();
    createTestCallToken = vi.fn().mockResolvedValue({
      token: "fake.jwt.token",
      ws_url: harness.url,
      mode: "chat",
    });
  });

  afterEach(async () => {
    await harness.close();
  });

  function getTool() {
    const server = createMockServer();
    registerTestTools(server as any, () => ({ createTestCallToken }) as any);
    const tool = server.getTool("test_agent_chat");
    if (!tool) throw new Error("test_agent_chat not registered");
    return tool;
  }

  it("registers the test_agent_chat tool", () => {
    const tool = getTool();
    expect(tool.name).toBe("test_agent_chat");
    expect(tool.description).toContain("WhatsApp");
    expect(tool.schema).toHaveProperty("business_id");
    expect(tool.schema).toHaveProperty("message");
  });

  it("sends a chat_message after the auth frame and returns the assistant_message reply", async () => {
    let receivedAuth: any = null;
    let receivedChat: any = null;

    harness.setHandler((sock) => {
      sock.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "auth") {
          receivedAuth = frame;
        } else if (frame.type === "chat_message") {
          receivedChat = frame;
          sock.send(
            JSON.stringify({
              type: "assistant_message",
              text: "Hello from the agent",
            }),
          );
        }
      });
    });

    const tool = getTool();
    const result = await tool.handler({
      business_id: "biz-123",
      message: "hi there",
      quiet_period_ms: 500,
      total_timeout_ms: 5_000,
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);

    expect(receivedAuth).toMatchObject({
      type: "auth",
      token: "fake.jwt.token",
      business_id: "biz-123",
      mode: "chat",
    });
    expect(receivedAuth.caller_id).toMatch(/^test-mcp-/);
    expect(receivedChat).toEqual({ type: "chat_message", text: "hi there" });
    expect(payload.replies).toHaveLength(1);
    expect(payload.replies[0].text).toBe("Hello from the agent");
    expect(payload.stop_reason).toBe("quiet_period");
    expect(createTestCallToken).toHaveBeenCalledWith({
      business_id: "biz-123",
      mode: "chat",
    });
  });

  it("collects multiple replies (Brain filler + Specialist final) within the quiet period", async () => {
    harness.setHandler((sock) => {
      sock.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "chat_message") {
          sock.send(
            JSON.stringify({
              type: "assistant_message",
              text: "One moment please…",
            }),
          );
          setTimeout(() => {
            sock.send(
              JSON.stringify({
                type: "assistant_message",
                text: "Here's the answer.",
              }),
            );
          }, 100);
        }
      });
    });

    const tool = getTool();
    const result = await tool.handler({
      business_id: "biz-123",
      message: "what time is it?",
      quiet_period_ms: 500,
      total_timeout_ms: 5_000,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.replies).toHaveLength(2);
    expect(payload.replies[0].text).toBe("One moment please…");
    expect(payload.replies[1].text).toBe("Here's the answer.");
    expect(payload.stop_reason).toBe("quiet_period");
  });

  it("forwards agent_id and a custom caller_id verbatim in the auth frame", async () => {
    let receivedAuth: any = null;
    harness.setHandler((sock) => {
      sock.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "auth") receivedAuth = frame;
        if (frame.type === "chat_message") {
          sock.send(
            JSON.stringify({ type: "assistant_message", text: "ok" }),
          );
        }
      });
    });

    const tool = getTool();
    await tool.handler({
      business_id: "biz-123",
      agent_id: "agent-abc",
      caller_id: "test-session-42",
      message: "hi",
      quiet_period_ms: 300,
      total_timeout_ms: 5_000,
    });

    expect(receivedAuth.agent_id).toBe("agent-abc");
    expect(receivedAuth.caller_id).toBe("test-session-42");
    expect(createTestCallToken).toHaveBeenCalledWith({
      business_id: "biz-123",
      mode: "chat",
      agent_id: "agent-abc",
    });
  });

  it("returns isError when the server emits an error frame", async () => {
    harness.setHandler((sock) => {
      sock.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "auth") {
          sock.send(
            JSON.stringify({
              type: "error",
              message: "Not authorized for this business_id",
            }),
          );
        }
      });
    });

    const tool = getTool();
    const result = await tool.handler({
      business_id: "biz-other",
      message: "hi",
      quiet_period_ms: 300,
      total_timeout_ms: 5_000,
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.replies).toHaveLength(0);
    expect(payload.errors.join(" ")).toContain("Not authorized");
  });

  it("returns isError when token minting fails", async () => {
    createTestCallToken.mockRejectedValueOnce(
      new Error("Davoxi API error 403 Forbidden"),
    );

    const tool = getTool();
    const result = await tool.handler({
      business_id: "biz-123",
      message: "hi",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("403 Forbidden");
  });

  it("respects the max_replies safety cap", async () => {
    harness.setHandler((sock) => {
      sock.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "chat_message") {
          for (let i = 0; i < 5; i++) {
            sock.send(
              JSON.stringify({
                type: "assistant_message",
                text: `reply ${i}`,
              }),
            );
          }
        }
      });
    });

    const tool = getTool();
    const result = await tool.handler({
      business_id: "biz-123",
      message: "spam me",
      max_replies: 2,
      quiet_period_ms: 500,
      total_timeout_ms: 5_000,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.replies).toHaveLength(2);
    expect(payload.stop_reason).toBe("max_replies");
  });

  it("rejects an invalid caller_id at zod validation time", () => {
    const tool = getTool();
    const callerSchema = (tool.schema as any).caller_id;
    expect(callerSchema).toBeDefined();
    // The schema should reject characters outside [A-Za-z0-9_+-].
    expect(() => callerSchema.parse("has spaces")).toThrow();
    expect(() => callerSchema.parse("with/slash")).toThrow();
    expect(callerSchema.parse("test-mcp-123_abc+1")).toBe("test-mcp-123_abc+1");
  });
});
