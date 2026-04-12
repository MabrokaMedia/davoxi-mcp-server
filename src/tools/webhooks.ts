/**
 * MCP tools for managing Davoxi webhooks.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

const WEBHOOK_EVENTS = [
  "call.started",
  "call.completed",
  "call.failed",
  "call.missed",
  "agent.invoked",
  "agent.error",
  "business.updated",
] as const;

export function registerWebhookTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── list_webhooks ─────────────────────────────────────────────────── //
  server.tool(
    "list_webhooks",
    "List all webhooks configured for a business. Webhooks send real-time HTTP POST notifications to your URL when events occur (e.g. call completed, agent invoked). Returns webhook IDs, URLs, subscribed events, and enabled status.",
    {
      business_id: z
        .string()
        .describe("The business ID to list webhooks for."),
    },
    async ({ business_id }) => {
      try {
        const webhooks = await getClient().listWebhooks(business_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(webhooks, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing webhooks: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── create_webhook ────────────────────────────────────────────────── //
  server.tool(
    "create_webhook",
    `Create a webhook to receive real-time notifications when events occur on a business.

Available events: ${WEBHOOK_EVENTS.join(", ")}

Your endpoint must return a 2xx status within 10 seconds. Failed deliveries are retried up to 3 times with exponential backoff. The webhook secret (returned on creation) should be used to verify payload signatures.`,
    {
      business_id: z
        .string()
        .describe("The business ID to create the webhook for."),
      url: z
        .string()
        .url()
        .describe(
          "The HTTPS URL that will receive webhook POST requests. Must be publicly accessible.",
        ),
      events: z
        .array(z.enum(WEBHOOK_EVENTS))
        .min(1)
        .describe(
          `Events to subscribe to. Options: ${WEBHOOK_EVENTS.join(", ")}`,
        ),
      enabled: z
        .boolean()
        .optional()
        .describe("Whether the webhook is active. Defaults to true."),
    },
    async (params) => {
      try {
        const webhook = await getClient().createWebhook(params.business_id, {
          url: params.url,
          events: params.events,
          enabled: params.enabled,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(webhook, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating webhook: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update_webhook ────────────────────────────────────────────────── //
  server.tool(
    "update_webhook",
    "Update a webhook's URL, subscribed events, or enabled status. Only provided fields are changed.",
    {
      business_id: z
        .string()
        .describe("The business ID that owns the webhook."),
      webhook_id: z
        .string()
        .describe("The webhook ID to update."),
      url: z
        .string()
        .url()
        .optional()
        .describe("New HTTPS endpoint URL."),
      events: z
        .array(z.enum(WEBHOOK_EVENTS))
        .min(1)
        .optional()
        .describe("New set of subscribed events. Replaces the entire list."),
      enabled: z
        .boolean()
        .optional()
        .describe("Set to false to pause the webhook, true to re-enable."),
    },
    async (params) => {
      try {
        const webhook = await getClient().updateWebhook(
          params.business_id,
          params.webhook_id,
          {
            url: params.url,
            events: params.events,
            enabled: params.enabled,
          },
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(webhook, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating webhook: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── delete_webhook ────────────────────────────────────────────────── //
  server.tool(
    "delete_webhook",
    "Permanently delete a webhook. It will immediately stop receiving events. This cannot be undone — you will need to create a new webhook if you want to resume notifications.",
    {
      business_id: z
        .string()
        .describe("The business ID that owns the webhook."),
      webhook_id: z
        .string()
        .describe("The webhook ID to delete."),
      confirm: z
        .boolean()
        .describe(
          "Must be set to true to confirm deletion. This prevents accidental removal.",
        ),
    },
    async ({ business_id, webhook_id, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Deletion not confirmed. Set confirm=true to permanently delete this webhook.",
            },
          ],
        };
      }
      try {
        await getClient().deleteWebhook(business_id, webhook_id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Webhook ${webhook_id} deleted successfully.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting webhook: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
