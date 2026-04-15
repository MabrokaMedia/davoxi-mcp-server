/**
 * MCP tools for managing org-wide tool credentials (shared API keys consumed
 * by agent tools, e.g. Ticketmaster, OpenWeatherMap, Alpha Vantage).
 *
 * The backend stores credential values in AWS SSM Parameter Store and
 * auto-generates the SSM path from the friendly key_name. When configuring
 * an agent tool, either:
 *   - Leave `auth_ssm_path` empty for public APIs, OR
 *   - Set `auth_ssm_path` to the path returned by `list_tool_credentials`.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

export function registerCredentialTools(
  server: McpServer,
  getClient: () => DavoxiClient,
) {
  // ── list_tool_credentials ────────────────────────────────────────── //
  server.tool(
    "list_tool_credentials",
    "List all org-wide tool credentials (API keys that agent tools can use to authenticate with external services). Returns each credential's friendly name, the auto-generated SSM path (pass this as `auth_ssm_path` when configuring an agent tool), whether a value is currently set, and a human-readable description. Use this to discover what's available BEFORE creating or updating an agent tool.",
    {},
    async () => {
      try {
        const creds = await getClient().listToolCredentials();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(creds, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing tool credentials: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── set_tool_credential ──────────────────────────────────────────── //
  server.tool(
    "set_tool_credential",
    "Create or update a tool credential. The backend stores the value securely in AWS SSM Parameter Store (SecureString) and returns the auto-generated SSM path. Use this to register an API key (e.g. Ticketmaster, OpenWeatherMap) that agent tools can then reference via `auth_ssm_path`. The `key_name` must be 1-50 characters, alphanumeric plus `-` and `_`.",
    {
      key_name: z
        .string()
        .min(1)
        .max(50)
        .regex(
          /^[A-Za-z0-9_-]+$/,
          "Key name must contain only letters, digits, - and _",
        )
        .describe(
          "Friendly name for the credential (e.g. 'ticketmaster', 'openweathermap', 'alpha_vantage').",
        ),
      value: z
        .string()
        .min(1)
        .describe("The secret value (API key/token). Will be stored as SecureString in SSM."),
    },
    async ({ key_name, value }) => {
      try {
        await getClient().setToolCredential(key_name, value);
        return {
          content: [
            {
              type: "text",
              text: `Credential '${key_name}' stored. Retrieve its SSM path via list_tool_credentials.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting tool credential: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
