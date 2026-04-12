/**
 * MCP tools for listing Davoxi phone numbers.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

export function registerPhoneTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── list_phone_numbers ────────────────────────────────────────────── //
  server.tool(
    "list_phone_numbers",
    "List all phone numbers on the account. Shows each number, which business it's assigned to, capabilities (voice, SMS), and status. Use this to see what numbers are available before assigning them to a business.",
    {},
    async () => {
      try {
        const numbers = await getClient().listPhoneNumbers();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(numbers, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing phone numbers: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
