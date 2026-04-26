/**
 * MCP tools for testing deployed Davoxi agents end-to-end.
 *
 * `test_agent_chat` mints a short-lived JWT via `POST /test-call/token`,
 * opens a chat-mode WebSocket against apprunner, sends one user message,
 * and collects every `assistant_message` frame the Brain → Master →
 * Specialist chain produces — exactly the same code path a real
 * WhatsApp/Voice request takes. Multi-turn continuity is achieved by
 * passing the same `caller_id` across calls.
 */

import { z } from "zod";
import WebSocket from "ws";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

// ---------------------------------------------------------------------------
// WebSocket runner — opens a session, sends one message, collects replies.
// ---------------------------------------------------------------------------

interface RunChatTurnInput {
  wsUrl: string;
  token: string;
  businessId: string;
  agentId?: string;
  callerId: string;
  message: string;
  /** Hard cap on the whole turn (ms). */
  totalTimeoutMs: number;
  /**
   * After the first `assistant_message` arrives, close the session once
   * this much wall-clock has passed without another message. Lets us
   * capture both the Brain's filler and the Specialist's final reply
   * without waiting the full `totalTimeoutMs`.
   */
  quietPeriodMs: number;
  /** Safety cap on collected replies. */
  maxReplies: number;
}

interface ReplyFrame {
  text: string;
  received_at: string;
  /** Milliseconds since the user message was sent. */
  latency_ms: number;
}

interface ChatTurnResult {
  replies: ReplyFrame[];
  /** Reason the runner stopped collecting. */
  stop_reason:
    | "quiet_period"
    | "session_ended"
    | "total_timeout"
    | "max_replies"
    | "server_closed";
  /** Diagnostic metadata to make failures explainable. */
  errors: string[];
}

async function runChatTurn(input: RunChatTurnInput): Promise<ChatTurnResult> {
  const replies: ReplyFrame[] = [];
  const errors: string[] = [];
  let stopReason: ChatTurnResult["stop_reason"] = "total_timeout";

  const ws = new WebSocket(input.wsUrl, {
    perMessageDeflate: false,
    handshakeTimeout: 10_000,
  });

  let messageSentAt = 0;
  let quietTimer: NodeJS.Timeout | null = null;
  let totalTimer: NodeJS.Timeout | null = null;

  const finish = (
    reason: ChatTurnResult["stop_reason"],
    resolve: () => void,
  ) => {
    stopReason = reason;
    if (quietTimer) clearTimeout(quietTimer);
    if (totalTimer) clearTimeout(totalTimer);
    quietTimer = null;
    totalTimer = null;
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      try {
        ws.close(1000, "test session complete");
      } catch {
        // best effort
      }
    }
    resolve();
  };

  await new Promise<void>((resolve) => {
    totalTimer = setTimeout(() => finish("total_timeout", resolve), input.totalTimeoutMs);

    ws.on("open", () => {
      const auth = {
        type: "auth",
        token: input.token,
        business_id: input.businessId,
        caller_id: input.callerId,
        mode: "chat",
        ...(input.agentId ? { agent_id: input.agentId } : {}),
      };
      try {
        ws.send(JSON.stringify(auth));
      } catch (err) {
        errors.push(`auth send failed: ${asMessage(err)}`);
        finish("server_closed", resolve);
        return;
      }
      // Send the user message immediately after auth — apprunner buffers
      // until the auth frame validates.
      messageSentAt = Date.now();
      try {
        ws.send(JSON.stringify({ type: "chat_message", text: input.message }));
      } catch (err) {
        errors.push(`message send failed: ${asMessage(err)}`);
        finish("server_closed", resolve);
      }
    });

    ws.on("message", (data) => {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        // Binary frames (PCM audio) — ignore. We only care about JSON text.
        return;
      }
      if (!frame || typeof frame !== "object") return;
      const f = frame as { type?: string; text?: string; message?: string };

      if (f.type === "error") {
        errors.push(`server error: ${f.message ?? "(no message)"}`);
        finish("server_closed", resolve);
        return;
      }

      if (f.type === "session_ended" || f.type === "end_session") {
        if (typeof f.text === "string" && f.text.trim()) {
          replies.push({
            text: f.text,
            received_at: new Date().toISOString(),
            latency_ms: messageSentAt ? Date.now() - messageSentAt : 0,
          });
        }
        finish("session_ended", resolve);
        return;
      }

      if (f.type === "assistant_message" && typeof f.text === "string") {
        replies.push({
          text: f.text,
          received_at: new Date().toISOString(),
          latency_ms: messageSentAt ? Date.now() - messageSentAt : 0,
        });
        if (replies.length >= input.maxReplies) {
          finish("max_replies", resolve);
          return;
        }
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(
          () => finish("quiet_period", resolve),
          input.quietPeriodMs,
        );
      }
    });

    ws.on("error", (err) => {
      errors.push(`ws error: ${asMessage(err)}`);
    });

    ws.on("close", (code, reason) => {
      if (replies.length === 0 && errors.length === 0) {
        errors.push(
          `ws closed before any reply (code=${code}${
            reason && reason.length ? `, reason=${reason.toString()}` : ""
          })`,
        );
      }
      finish(stopReason === "total_timeout" ? "server_closed" : stopReason, resolve);
    });
  });

  return { replies, stop_reason: stopReason, errors };
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function randomCallerId(): string {
  // Apprunner's caller_id validator allows alphanumeric + `-+_`, max 50 chars.
  // Use a `test-mcp-` prefix so these sessions are easy to spot in logs.
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `test-mcp-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTestTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  server.tool(
    "test_agent_chat",
    `Send a test message to a deployed business as if you were a real WhatsApp caller, and return every reply the agent produces.

This exercises the full production code path — Brain → Master Orchestrator → Specialist agent → response — using the same WebSocket the dashboard test-chat uses. No real Twilio message is sent, no SMS is delivered, and the session is namespaced so it does not pollute production conversation history (default caller_id is auto-generated as "test-mcp-…").

Use this to verify that an agent answers the way you intend without having to message it from a real phone. For multi-turn conversations, pass the same caller_id across calls so the Brain remembers the prior context.

Returns an array of replies (the Brain may emit a filler then the Specialist's final answer), the total time, and a stop_reason explaining when collection ended.`,
    {
      business_id: z
        .string()
        .min(1)
        .describe("The business to test. Must belong to your org."),
      message: z
        .string()
        .min(1)
        .max(4096)
        .describe(
          "What the simulated user is saying — exactly the text a real caller would type on WhatsApp.",
        ),
      agent_id: z
        .string()
        .optional()
        .describe(
          "Optional — pin the session to one specialist agent. Omit to let the Master Orchestrator route the message normally.",
        ),
      caller_id: z
        .string()
        .min(1)
        .max(50)
        .regex(/^[A-Za-z0-9_+-]+$/)
        .optional()
        .describe(
          "Stable identifier for multi-turn continuity. Pass the same value across calls to keep the same conversation thread. Auto-generated as 'test-mcp-…' when omitted.",
        ),
      total_timeout_ms: z
        .number()
        .int()
        .min(5_000)
        .max(120_000)
        .optional()
        .describe(
          "Hard cap on the whole turn in milliseconds (default 30000, max 120000). Increase only when an agent is known to make slow tool calls.",
        ),
      quiet_period_ms: z
        .number()
        .int()
        .min(500)
        .max(30_000)
        .optional()
        .describe(
          "After the first reply arrives, close the session once this much wall-clock has passed without another reply (default 5000). Lets you capture both the Brain's filler and the Specialist's final answer without waiting the whole timeout.",
        ),
      max_replies: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Safety cap on the number of replies collected (default 6)."),
    },
    async (params) => {
      const callerId = params.caller_id ?? randomCallerId();
      const totalTimeoutMs = params.total_timeout_ms ?? 30_000;
      const quietPeriodMs = params.quiet_period_ms ?? 5_000;
      const maxReplies = params.max_replies ?? 6;

      try {
        const tokenResp = await getClient().createTestCallToken({
          business_id: params.business_id,
          mode: "chat",
          ...(params.agent_id ? { agent_id: params.agent_id } : {}),
        });

        const startedAt = Date.now();
        const result = await runChatTurn({
          wsUrl: tokenResp.ws_url,
          token: tokenResp.token,
          businessId: params.business_id,
          agentId: params.agent_id,
          callerId,
          message: params.message,
          totalTimeoutMs,
          quietPeriodMs,
          maxReplies,
        });
        const elapsedMs = Date.now() - startedAt;

        const isFailure =
          result.replies.length === 0 && result.errors.length > 0;

        const payload = {
          business_id: params.business_id,
          agent_id: params.agent_id ?? null,
          caller_id: callerId,
          sent: params.message,
          replies: result.replies,
          stop_reason: result.stop_reason,
          elapsed_ms: elapsedMs,
          ...(result.errors.length ? { errors: result.errors } : {}),
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload, null, 2) },
          ],
          ...(isFailure ? { isError: true } : {}),
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running test_agent_chat: ${asMessage(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
