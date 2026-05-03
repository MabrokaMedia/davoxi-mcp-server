/**
 * MCP tools for managing Davoxi orgs.
 *
 * An Org is the top-level tenant. Today the Davoxi platform has one org
 * per customer; the org's `name` shows up in admin tooling, billing
 * exports, and the dashboard's account switcher. These tools expose the
 * non-sensitive Org metadata so an assistant can look it up and rename
 * it without dropping into AWS / DDB.
 *
 * Sensitive fields (`twilio_link` credentials, etc.) are NOT exposed —
 * they have their own dedicated endpoints.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient, UpdateOrgInput } from "@davoxi/client";

export function registerOrgTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── get_org ──────────────────────────────────────────────────────── //
  server.tool(
    "get_org",
    "Get non-sensitive Org metadata: org_id, name, owner_id, plan_id, business_ids, and twilio_link_kind (presence-only). Sensitive Twilio credentials are NOT included — those go through the dedicated /twilio endpoints.",
    {
      org_id: z
        .string()
        .min(1)
        .describe("The unique identifier of the org (e.g. 'org_a0cc65dbbb19')."),
    },
    async ({ org_id }) => {
      try {
        const org = await getClient().getOrg(org_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(org, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting org: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update_org ───────────────────────────────────────────────────── //
  server.tool(
    "update_org",
    "Partially update Org metadata. Only the fields you set are changed. Pass plan_id: null to clear the plan. business_ids, twilio_link, and owner_id are read-only on this tool — those go through their own endpoints.",
    {
      org_id: z
        .string()
        .min(1)
        .describe("The unique identifier of the org to update."),
      name: z
        .string()
        .min(1)
        .max(255)
        .optional()
        .describe(
          "New display name for the org (1-255 chars). E.g. 'Parlo Labs Ltd'.",
        ),
      plan_id: z
        .string()
        .min(1)
        .max(64)
        .nullable()
        .optional()
        .describe(
          "New plan tier (e.g. 'starter', 'growth', 'enterprise'). Pass null to clear.",
        ),
    },
    async ({ org_id, name, plan_id }) => {
      try {
        const input: UpdateOrgInput = {};
        if (name !== undefined) input.name = name;
        if (plan_id !== undefined) input.plan_id = plan_id;

        if (Object.keys(input).length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error updating org: no fields to update. Provide at least one of `name` or `plan_id`.",
              },
            ],
            isError: true,
          };
        }

        const updated = await getClient().updateOrg(org_id, input);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating org: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
