/**
 * MCP tools for Davoxi caller management — profiles, linked services, insights.
 *
 * The @davoxi/client SDK does not yet expose caller endpoints, so these tools
 * call the REST API directly using the same authentication headers.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// Lightweight API helper (reuses the same auth as DavoxiClient)
// ---------------------------------------------------------------------------

interface CallerApiOptions {
  apiKey: string;
  apiUrl: string;
}

async function callerRequest(
  opts: CallerApiOptions,
  method: string,
  path: string,
): Promise<unknown> {
  const url = `${opts.apiUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
  }

  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCallerTools(
  server: McpServer,
  apiOpts: CallerApiOptions,
): void {
  // ── list_callers ───────────────────────────────────────────────────── //
  server.tool(
    "list_callers",
    `List caller profiles for your organization with optional search, filtering, and pagination.

Returns paginated results with caller name, phone hash, language, total calls, linked services, and timestamps. Use the cursor parameter from a previous response's next_cursor to get the next page.`,
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (default 25, max 100)."),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous response."),
      search: z
        .string()
        .optional()
        .describe("Search by caller name or phone hash."),
      language: z
        .string()
        .optional()
        .describe("Filter by language (e.g. 'en', 'es')."),
      has_services: z
        .boolean()
        .optional()
        .describe("If true, only return callers with linked services."),
    },
    async (params) => {
      try {
        const qs = new URLSearchParams();
        if (params.limit) qs.set("limit", String(params.limit));
        if (params.cursor) qs.set("cursor", params.cursor);
        if (params.search) qs.set("search", params.search);
        if (params.language) qs.set("language", params.language);
        if (params.has_services) qs.set("has_services", "true");
        const q = qs.toString();
        const result = await callerRequest(
          apiOpts,
          "GET",
          `/callers${q ? `?${q}` : ""}`,
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing callers: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_caller ─────────────────────────────────────────────────────── //
  server.tool(
    "get_caller",
    "Get detailed profile for a specific caller by their phone hash, including total calls, language, linked services, and preferences.",
    {
      phone_hash: z
        .string()
        .describe("The phone hash identifier of the caller."),
    },
    async ({ phone_hash }) => {
      try {
        const result = await callerRequest(
          apiOpts,
          "GET",
          `/callers/${encodeURIComponent(phone_hash)}`,
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting caller: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── list_caller_services ───────────────────────────────────────────── //
  server.tool(
    "list_caller_services",
    "List all linked third-party services (e.g. Uber, Spotify, Google) for a specific caller.",
    {
      phone_hash: z
        .string()
        .describe("The phone hash identifier of the caller."),
    },
    async ({ phone_hash }) => {
      try {
        const result = await callerRequest(
          apiOpts,
          "GET",
          `/callers/${encodeURIComponent(phone_hash)}/services`,
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing caller services: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── unlink_caller_service ──────────────────────────────────────────── //
  server.tool(
    "unlink_caller_service",
    "Unlink a third-party service from a caller. The caller can re-link it on their next call. Requires confirm=true for safety.",
    {
      phone_hash: z
        .string()
        .describe("The phone hash identifier of the caller."),
      service: z
        .string()
        .describe("The service name to unlink (e.g. 'uber', 'spotify')."),
      confirm: z
        .boolean()
        .describe("Must be true to confirm the unlink operation."),
    },
    async ({ phone_hash, service, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Unlink cancelled — set confirm=true to proceed.",
            },
          ],
        };
      }
      try {
        const result = await callerRequest(
          apiOpts,
          "DELETE",
          `/callers/${encodeURIComponent(phone_hash)}/services/${encodeURIComponent(service)}`,
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error unlinking service: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
