/**
 * MCP tools for Davoxi usage analytics and billing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

export function registerAnalyticsTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── get_usage ────────────────────────────────────────────────────── //
  server.tool(
    "get_usage",
    "Get detailed usage statistics broken down by resource. Shows call counts, minutes, and costs for each business and agent. Useful for identifying which agents are being used most and understanding per-resource costs.",
    {},
    async () => {
      try {
        const usage = await getClient().getUsage();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(usage, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting usage: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_usage_summary ────────────────────────────────────────────── //
  server.tool(
    "get_usage_summary",
    "Get an aggregated usage summary for the current billing period. Returns total calls, total minutes, total cost, and the period start/end dates. Use this for a quick overview of your account's usage.",
    {},
    async () => {
      try {
        const summary = await getClient().getUsageSummary();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting usage summary: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_subscription ─────────────────────────────────────────────── //
  server.tool(
    "get_subscription",
    "Get the current billing subscription details. Shows the plan name, status (active, canceled, past_due, etc.), current billing period dates, and whether cancellation is scheduled at period end.",
    {},
    async () => {
      try {
        const subscription = await getClient().getSubscription();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(subscription, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting subscription: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── list_invoices ────────────────────────────────────────────────── //
  server.tool(
    "list_invoices",
    "List all billing invoices for the account. Each invoice includes the amount, currency, status (paid, open, void), creation date, and optionally a PDF download URL.",
    {},
    async () => {
      try {
        const invoices = await getClient().listInvoices();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(invoices, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing invoices: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
