/**
 * MCP tools for Davoxi account management (profile & API keys).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

export function registerAccountTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── get_profile ──────────────────────────────────────────────────── //
  server.tool(
    "get_profile",
    "Get the current authenticated user's profile. Returns user ID, email, name, and account creation date. Useful for verifying which account is connected.",
    {},
    async () => {
      try {
        const profile = await getClient().getProfile();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting profile: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── list_api_keys ────────────────────────────────────────────────── //
  server.tool(
    "list_api_keys",
    "List all API keys on the account. Shows each key's prefix (first few characters for identification), optional name, creation date, and last used date. The full key value is never returned for security.",
    {},
    async () => {
      try {
        const keys = await getClient().listApiKeys();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(keys, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing API keys: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── create_api_key ───────────────────────────────────────────────── //
  server.tool(
    "create_api_key",
    "Create a new API key for the Davoxi account. Returns the full key value (starts with 'sk_') — this is the ONLY time the full key is shown, so make sure to save it. Optionally give the key a name for identification.",
    {
      name: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "An optional human-readable name for the API key (e.g. 'production', 'staging', 'ci-cd'). Helps identify the key later.",
        ),
    },
    async ({ name }) => {
      try {
        const key = await getClient().createApiKey(name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(key, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating API key: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── revoke_api_key ───────────────────────────────────────────────── //
  server.tool(
    "revoke_api_key",
    "Permanently revoke an API key by its prefix. The key will immediately stop working for authentication. This cannot be undone — any services using this key will lose access. Requires confirm=true as a safety check. Use list_api_keys first to find the prefix.",
    {
      prefix: z
        .string()
        .describe(
          "The prefix of the API key to revoke. Get this from list_api_keys (e.g. 'sk_abc1').",
        ),
      confirm: z
        .boolean()
        .describe(
          "Must be set to true to confirm revocation. This is a safety check because any integrations using this key will immediately lose access.",
        ),
    },
    async ({ prefix, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Revocation not confirmed. Set confirm=true to permanently revoke API key '${prefix}'. Any services or integrations using this key will immediately lose access.`,
            },
          ],
        };
      }
      try {
        await getClient().revokeApiKey(prefix);
        return {
          content: [
            {
              type: "text" as const,
              text: `API key with prefix '${prefix}' revoked successfully. Create a new key with create_api_key if you need a replacement.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error revoking API key: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
