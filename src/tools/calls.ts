/**
 * MCP tools for Davoxi call logs and history.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

export function registerCallTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── list_call_logs ────────────────────────────────────────────────── //
  server.tool(
    "list_call_logs",
    `List call logs for a business with optional filtering by date range, status, or agent. Returns paginated results with call details including duration, direction, status, and summary.

Use the cursor parameter for pagination — pass the next_cursor value from a previous response to get the next page.`,
    {
      business_id: z
        .string()
        .describe("The business ID to list calls for."),
      start_date: z
        .string()
        .optional()
        .describe(
          "Filter calls starting from this date (ISO 8601, e.g. '2026-01-01'). Useful for checking recent activity.",
        ),
      end_date: z
        .string()
        .optional()
        .describe(
          "Filter calls up to this date (ISO 8601, e.g. '2026-01-31').",
        ),
      status: z
        .enum(["completed", "missed", "failed", "in_progress"])
        .optional()
        .describe("Filter by call status."),
      agent_id: z
        .string()
        .optional()
        .describe("Filter calls handled by a specific agent."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (default 50, max 100)."),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response's next_cursor field."),
    },
    async (params) => {
      try {
        const result = await getClient().listCallLogs(params.business_id, {
          start_date: params.start_date,
          end_date: params.end_date,
          status: params.status,
          agent_id: params.agent_id,
          limit: params.limit,
          cursor: params.cursor,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing call logs: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_call_log ──────────────────────────────────────────────────── //
  server.tool(
    "get_call_log",
    `Get detailed information about a specific call including transcript, recording URL, duration, which agent handled it, and a summary of the conversation.

Call logs are partitioned by UTC date in S3, so the upstream API requires the date the call started. Pass it via the \`date\` parameter (YYYY-MM-DD); when omitted, today's UTC date is used.`,
    {
      business_id: z
        .string()
        .describe("The business ID that owns the call."),
      call_id: z
        .string()
        .describe("The unique identifier of the call to retrieve."),
      date: z
        .string()
        .regex(
          /^\d{4}-\d{2}-\d{2}$/,
          "date must be YYYY-MM-DD (UTC)",
        )
        .optional()
        .describe(
          "UTC date the call started (YYYY-MM-DD). Required by the upstream API to locate the call log; defaults to today's UTC date if omitted.",
        ),
    },
    async ({ business_id, call_id, date }) => {
      try {
        const resolvedDate = date ?? todayUtcDate();
        const call = await getClient().getCallLog(business_id, call_id, {
          date: resolvedDate,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(call, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting call log: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}
