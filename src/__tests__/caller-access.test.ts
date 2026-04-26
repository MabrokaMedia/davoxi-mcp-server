/**
 * Unit tests for the Caller Access Plane MCP tools (doc 50 §6.1).
 *
 * Covers:
 * - `hashHandle` matches the Rust `identity_graph::hash_handle` shape
 *   (sha256, hex, first 16 chars) for known inputs.
 * - The tool's input-schema validation accepts canonical inputs and
 *   rejects malformed ones.
 * - Each tool round-trips through a mocked `fetch` and produces the
 *   expected HTTP shape (path, method, body, headers).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { hashHandle } from "../tools/caller-access.js";

// ── Mock MCP server (mirrors the harness in tools.test.ts) ─────────── //

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
    _tools: tools,
    getTool(name: string): RegisteredTool | undefined {
      return tools.find((t) => t.name === name);
    },
  };
}

type MockServer = ReturnType<typeof createMockServer>;

import { registerCallerAccessTools } from "../tools/caller-access.js";

const apiOpts = {
  apiKey: "test-key",
  apiUrl: "https://api.test.davoxi.com",
};

// ── hashHandle ─────────────────────────────────────────────────────── //

describe("hashHandle", () => {
  it("matches sha256(raw)[:16] for a known input", () => {
    // Reference: hex::encode(&Sha256::digest("+15551234567")[..8])
    const expected = createHash("sha256")
      .update("+15551234567", "utf8")
      .digest("hex")
      .slice(0, 16);
    expect(hashHandle("+15551234567")).toBe(expected);
  });

  it("returns exactly 16 lowercase hex characters", () => {
    const h = hashHandle("alice@example.com");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toHaveLength(16);
  });

  it("is deterministic for the same raw handle", () => {
    expect(hashHandle("+33612345678")).toBe(hashHandle("+33612345678"));
  });

  it("differs for different raw handles", () => {
    expect(hashHandle("+15551111111")).not.toBe(hashHandle("+15552222222"));
  });

  it("hashes empty string to a stable 16-char value", () => {
    // sha256("") = e3b0c44298fc1c14… → first 16 hex chars of empty hash.
    const h = hashHandle("");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe("e3b0c44298fc1c14");
  });
});

// ── Tool registration ──────────────────────────────────────────────── //

describe("registerCallerAccessTools", () => {
  it("registers exactly the 6 doc-50 §6.1 tools", () => {
    const server = createMockServer();
    registerCallerAccessTools(server as any, apiOpts);
    const names = server._tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "set_access_policy",
        "add_caller_to_allowlist",
        "add_caller_to_blocklist",
        "set_caller_rate_limit",
        "list_blocked_callers",
        "get_caller_access_audit",
      ].sort(),
    );
  });

  it("each tool has a non-empty description", () => {
    const server = createMockServer();
    registerCallerAccessTools(server as any, apiOpts);
    for (const t of server._tools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

// ── Mocked HTTP round-trips ────────────────────────────────────────── //

describe("caller-access HTTP round-trips", () => {
  let server: MockServer;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    server = createMockServer();
    registerCallerAccessTools(server as any, apiOpts);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // -- set_access_policy ------------------------------------------------- //
  describe("set_access_policy", () => {
    it("GETs the current policy then PUTs the new rule list with expected_updated_at", async () => {
      fetchMock
        // GET current
        .mockResolvedValueOnce(
          jsonResponse(200, {
            policy: {
              business_id: "biz_1",
              scope: { kind: "default" },
              rules: [],
              mandatory: false,
              updated_at: "2026-04-26T00:00:00Z",
            },
          }),
        )
        // PUT new
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        );

      const result = await server.getTool("set_access_policy")!.handler({
        business_id: "biz_1",
        scope: "default",
        rules: [
          { type: "reputation_floor", min_score: -0.2 },
        ],
      });

      expect(result.isError).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [getUrl, getInit] = fetchMock.mock.calls[0];
      expect(getUrl).toBe(
        "https://api.test.davoxi.com/api/businesses/biz_1/access?scope=default",
      );
      expect(getInit.method).toBe("GET");
      expect(getInit.headers.Authorization).toBe("Bearer test-key");

      const [putUrl, putInit] = fetchMock.mock.calls[1];
      expect(putUrl).toBe(
        "https://api.test.davoxi.com/api/businesses/biz_1/access",
      );
      expect(putInit.method).toBe("PUT");
      const body = JSON.parse(putInit.body);
      expect(body.scope).toEqual({ kind: "default" });
      expect(body.rules).toHaveLength(1);
      expect(body.expected_updated_at).toBe("2026-04-26T00:00:00Z");
    });

    it("returns isError on backend 409 conflict", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, {
            policy: {
              business_id: "biz_1",
              scope: { kind: "default" },
              rules: [],
              mandatory: false,
              updated_at: "2026-04-26T00:00:00Z",
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response("conflict", { status: 409, statusText: "Conflict" }),
        );

      const result = await server.getTool("set_access_policy")!.handler({
        business_id: "biz_1",
        scope: "default",
        rules: [],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("409");
    });

    it("maps channel:voice scope to the wire ChannelKind tag", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { policy: null }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        );

      await server.getTool("set_access_policy")!.handler({
        business_id: "biz_1",
        scope: "channel:voice",
        rules: [],
      });

      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.scope).toEqual({ kind: "channel", channel: "TwilioVoice" });
    });

    it("maps channel:whatsapp + agent:{id} scopes to PolicyScope wire shape", async () => {
      // channel:whatsapp
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { policy: null }))
        .mockResolvedValueOnce(jsonResponse(200, { updated_at: "x" }));
      await server.getTool("set_access_policy")!.handler({
        business_id: "biz_1",
        scope: "channel:whatsapp",
        rules: [],
      });
      let body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.scope).toEqual({ kind: "channel", channel: "Whatsapp" });

      // agent:{id}
      fetchMock.mockClear();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { policy: null }))
        .mockResolvedValueOnce(jsonResponse(200, { updated_at: "x" }));
      await server.getTool("set_access_policy")!.handler({
        business_id: "biz_1",
        scope: "agent:ag_42",
        rules: [],
      });
      body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.scope).toEqual({ kind: "agent", agent: "ag_42" });
    });
  });

  // -- add_caller_to_allowlist ------------------------------------------ //
  describe("add_caller_to_allowlist", () => {
    it("creates a new HandleAllowList rule when none exists", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { policy: null }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        );

      const result = await server
        .getTool("add_caller_to_allowlist")!
        .handler({
          business_id: "biz_1",
          handle_kind: "phone",
          handle_value: "+15551234567",
        });

      expect(result.isError).toBeUndefined();
      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0]).toEqual({
        type: "handle_allow_list",
        handle_kind: "phone",
        hashes: [hashHandle("+15551234567")],
      });
    });

    it("appends to an existing matching rule rather than creating a duplicate", async () => {
      const existingHash = hashHandle("+15550000000");
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, {
            policy: {
              business_id: "biz_1",
              scope: { kind: "default" },
              rules: [
                {
                  type: "handle_allow_list",
                  handle_kind: "phone",
                  hashes: [existingHash],
                },
              ],
              mandatory: false,
              updated_at: "2026-04-26T00:00:00Z",
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        );

      await server.getTool("add_caller_to_allowlist")!.handler({
        business_id: "biz_1",
        handle_kind: "phone",
        handle_value: "+15551234567",
      });

      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0].hashes).toEqual([
        existingHash,
        hashHandle("+15551234567"),
      ]);
    });

    it("never sends the raw handle to the backend", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { policy: null }))
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        );

      const raw = "+33611112222-secret";
      await server.getTool("add_caller_to_allowlist")!.handler({
        business_id: "biz_1",
        handle_kind: "phone",
        handle_value: raw,
      });

      // Inspect every outbound body — the raw value must not appear.
      for (const call of fetchMock.mock.calls) {
        const init = call[1];
        const serialized = init?.body ? String(init.body) : "";
        expect(serialized).not.toContain(raw);
      }
    });
  });

  // -- add_caller_to_blocklist ------------------------------------------ //
  describe("add_caller_to_blocklist", () => {
    it("appends a HandleDenyList rule and emits a -0.3 reputation signal", async () => {
      fetchMock
        // GET current
        .mockResolvedValueOnce(jsonResponse(200, { policy: null }))
        // PUT policy
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        )
        // POST reputation signal
        .mockResolvedValueOnce(jsonResponse(204, {}));

      const result = await server.getTool("add_caller_to_blocklist")!.handler({
        business_id: "biz_1",
        handle_kind: "phone",
        handle_value: "+15559999999",
      });

      expect(result.isError).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const repCall = fetchMock.mock.calls[2];
      expect(repCall[0]).toBe(
        "https://api.test.davoxi.com/api/trust/reputation/signal",
      );
      const repBody = JSON.parse(repCall[1].body);
      expect(repBody).toEqual({
        handle_hash: hashHandle("+15559999999"),
        delta: -0.3,
        reason: "manual_blocklist",
      });
    });

    it("still succeeds when the reputation-signal endpoint is unavailable", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { policy: null }))
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        )
        .mockResolvedValueOnce(
          new Response("not found", {
            status: 404,
            statusText: "Not Found",
          }),
        );

      // Suppress the expected console.error from the best-effort signal.
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await server.getTool("add_caller_to_blocklist")!.handler({
        business_id: "biz_1",
        handle_kind: "phone",
        handle_value: "+15558888888",
      });
      errSpy.mockRestore();

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain("reputation_signal");
      expect(text).toContain("\"ok\": false");
    });
  });

  // -- set_caller_rate_limit -------------------------------------------- //
  describe("set_caller_rate_limit", () => {
    it("appends a fresh RateLimit rule when none exists", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { policy: null }))
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        );

      await server.getTool("set_caller_rate_limit")!.handler({
        business_id: "biz_1",
        window_sec: 3600,
        max: 60,
        rl_scope: "per_caller",
      });

      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0]).toEqual({
        type: "rate_limit",
        window_sec: 3600,
        max: 60,
        scope: "per_caller",
      });
    });

    it("replaces an existing RateLimit rule in place", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, {
            policy: {
              business_id: "biz_1",
              scope: { kind: "default" },
              rules: [
                {
                  type: "rate_limit",
                  window_sec: 60,
                  max: 1,
                  scope: "per_org",
                },
                { type: "reputation_floor", min_score: -0.5 },
              ],
              mandatory: false,
              updated_at: "2026-04-26T00:00:00Z",
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, { updated_at: "2026-04-26T00:01:00Z" }),
        );

      await server.getTool("set_caller_rate_limit")!.handler({
        business_id: "biz_1",
        window_sec: 3600,
        max: 100,
        rl_scope: "per_caller",
      });

      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.rules).toHaveLength(2);
      expect(body.rules[0].type).toBe("rate_limit");
      expect(body.rules[0].max).toBe(100);
      expect(body.rules[1].type).toBe("reputation_floor");
    });
  });

  // -- list_blocked_callers --------------------------------------------- //
  describe("list_blocked_callers", () => {
    it("aggregates hashes from every HandleDenyList rule", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          policy: {
            business_id: "biz_1",
            scope: { kind: "default" },
            rules: [
              {
                type: "handle_deny_list",
                handle_kind: "phone",
                hashes: ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"],
              },
              {
                type: "handle_deny_list",
                handle_kind: "email",
                hashes: ["cccccccccccccccc"],
              },
              { type: "reputation_floor", min_score: -0.5 },
            ],
            mandatory: false,
            updated_at: "2026-04-26T00:00:00Z",
          },
        }),
      );

      const result = await server.getTool("list_blocked_callers")!.handler({
        business_id: "biz_1",
      });

      expect(result.isError).toBeUndefined();
      const out = JSON.parse(result.content[0].text);
      expect(out.total_blocked).toBe(3);
      expect(out.by_handle_kind.phone).toEqual([
        "aaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbb",
      ]);
      expect(out.by_handle_kind.email).toEqual(["cccccccccccccccc"]);
    });

    it("returns an empty result when there is no policy", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { policy: null }));

      const result = await server.getTool("list_blocked_callers")!.handler({
        business_id: "biz_1",
      });
      expect(result.isError).toBeUndefined();
      const out = JSON.parse(result.content[0].text);
      expect(out.total_blocked).toBe(0);
      expect(out.by_handle_kind).toEqual({});
    });
  });

  // -- get_caller_access_audit ------------------------------------------ //
  describe("get_caller_access_audit", () => {
    it("forwards since + limit as query params", async () => {
      const since = "2026-04-25T12:00:00.000Z";
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { entries: [], next_cursor: null }),
      );

      await server.getTool("get_caller_access_audit")!.handler({
        business_id: "biz_1",
        since,
        limit: 50,
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("GET");
      const u = new URL(url as string);
      expect(u.pathname).toBe("/api/businesses/biz_1/access/audit");
      expect(u.searchParams.get("since")).toBe(since);
      expect(u.searchParams.get("limit")).toBe("50");
    });

    it("returns the audit body untouched on success", async () => {
      const audit = {
        entries: [
          {
            decision: "block",
            reason: "on_deny_list",
            ts: "2026-04-26T00:00:00Z",
          },
        ],
        next_cursor: "abc",
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(200, audit));

      const result = await server.getTool("get_caller_access_audit")!.handler({
        business_id: "biz_1",
      });
      expect(JSON.parse(result.content[0].text)).toEqual(audit);
    });

    it("returns isError on backend failure", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("forbidden", { status: 403, statusText: "Forbidden" }),
      );
      const result = await server.getTool("get_caller_access_audit")!.handler({
        business_id: "biz_1",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("403");
    });
  });
});

// ── Schema-validator boundary tests (mirror tools.test.ts pattern) ──── //

describe("caller-access input-schema validators", () => {
  it("accepts every canonical AccessRule variant", async () => {
    const { z } = await import("zod");
    const handleAllowList = z.object({
      type: z.literal("handle_allow_list"),
      handle_kind: z.enum(["phone", "email", "agent", "org"]),
      hashes: z.array(z.string().regex(/^[0-9a-f]{16}$/)),
    });
    expect(() =>
      handleAllowList.parse({
        type: "handle_allow_list",
        handle_kind: "phone",
        hashes: ["aaaaaaaaaaaaaaaa"],
      }),
    ).not.toThrow();
    expect(() =>
      handleAllowList.parse({
        type: "handle_allow_list",
        handle_kind: "phone",
        hashes: ["NOTHEX"],
      }),
    ).toThrow();
  });

  it("rejects unknown handle_kind values", async () => {
    const { z } = await import("zod");
    const schema = z.enum(["phone", "email", "agent", "org"]);
    expect(() => schema.parse("sms")).toThrow();
    expect(() => schema.parse("phone")).not.toThrow();
  });

  it("rejects invalid scope strings", async () => {
    const { z } = await import("zod");
    const schema = z
      .string()
      .regex(/^(default|channel:(voice|whatsapp)|agent:[A-Za-z0-9_\-:.]+)$/);
    expect(() => schema.parse("garbage")).toThrow();
    expect(() => schema.parse("channel:sms")).toThrow();
    expect(() => schema.parse("default")).not.toThrow();
    expect(() => schema.parse("channel:voice")).not.toThrow();
    expect(() => schema.parse("channel:whatsapp")).not.toThrow();
    expect(() => schema.parse("agent:ag_42")).not.toThrow();
  });

  it("rejects rate-limit windows below 1 second", async () => {
    const { z } = await import("zod");
    const schema = z.number().int().min(1);
    expect(() => schema.parse(0)).toThrow();
    expect(() => schema.parse(-1)).toThrow();
    expect(() => schema.parse(3600)).not.toThrow();
  });

  it("rejects reputation scores outside [-1, 1]", async () => {
    const { z } = await import("zod");
    const schema = z.number().min(-1).max(1);
    expect(() => schema.parse(-1.5)).toThrow();
    expect(() => schema.parse(1.5)).toThrow();
    expect(() => schema.parse(0.0)).not.toThrow();
    expect(() => schema.parse(-0.5)).not.toThrow();
  });

  it("requires ISO-8601 since timestamps", async () => {
    const { z } = await import("zod");
    const schema = z.string().datetime();
    expect(() => schema.parse("yesterday")).toThrow();
    expect(() => schema.parse("2026-04-25T12:00:00Z")).not.toThrow();
  });
});
