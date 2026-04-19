/**
 * MCP tools for managing the org-scoped tool registry
 * (`davoxi-tool-registry-{stage}`).
 *
 * Each registry row is a `RegisteredTool` referenced by one or more
 * specialist agents via `tool_refs`. The runtime resolves these refs
 * at dispatch time — endpoint, input_schema, auth, response_template
 * all flow from the registry row, so editing the row here is the
 * canonical way to fix a tool's LLM-facing schema or its actual
 * upstream HTTP shape.
 *
 * # Backend endpoints
 *
 * | Method | Path                       | Helper        |
 * |--------|----------------------------|---------------|
 * | GET    | /tools                     | `list_tools`  |
 * | POST   | /tools                     | `create_tool` |
 * | GET    | /tools/{tool_id}           | `get_tool`    |
 * | PUT    | /tools/{tool_id}           | `update_tool` |
 * | DELETE | /tools/{tool_id}           | `delete_tool` |
 *
 * The org scope is implicit in the bearer token — the API key the
 * MCP authenticates with belongs to one org and the backend filters
 * automatically. Multi-org MCP installs need a separate token + a
 * fresh MCP session per org for now.
 *
 * Implemented as raw `fetch` against the same base URL the
 * `@davoxi/client` uses, because the client doesn't expose a request
 * passthrough and these tool routes haven't been added to its
 * method surface yet (tracked separately).
 *
 * Auth: same env variable the rest of the MCP reads
 * (`DAVOXI_API_KEY`, falls back to `~/.davoxi/mcp.json`). Base URL
 * comes from `DAVOXI_API_URL` (defaults to `https://api.davoxi.com`).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadMcpCredentials } from "../auth/credentials.js";

// ─── Resolved-once-per-call config ─────────────────────────────────── //

function resolveBaseUrl(): string {
  return (process.env.DAVOXI_API_URL ?? "https://api.davoxi.com").replace(
    /\/+$/,
    "",
  );
}

function resolveApiKey(): string {
  const envKey = process.env.DAVOXI_API_KEY;
  if (envKey && envKey.length > 0) return envKey;
  const saved = loadMcpCredentials();
  if (saved?.api_key) return saved.api_key;
  throw new Error(
    "No Davoxi API key found. Set DAVOXI_API_KEY or run `npx @davoxi/mcp-server auth login`.",
  );
}

// ─── Raw HTTP helper (same wire shape as @davoxi/client) ───────────── //

interface DavoxiHttpError {
  statusCode: number;
  statusText: string;
  body: string;
}

async function davoxiFetch<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${resolveBaseUrl()}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${resolveApiKey()}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(
      `Network error calling Davoxi API (${method} ${path}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const httpErr: DavoxiHttpError = {
      statusCode: res.status,
      statusText: res.statusText,
      body: text,
    };
    throw new Error(
      `Davoxi API ${method} ${path} → ${httpErr.statusCode} ${httpErr.statusText}: ${httpErr.body}`,
    );
  }
  // 204 No Content has no body to parse.
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ─── URL encoding (matches @davoxi/client's enc helper) ────────────── //

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// ─── Re-used schemas ───────────────────────────────────────────────── //

/**
 * `ToolExecution` schema as the davoxi-backend expects it. Keep
 * permissive — the backend has its own normalisation pass and we
 * don't want to over-constrain new fields here.
 */
const toolExecutionSchema = z
  .object({
    type: z
      .enum(["rest_api", "oauth2_api", "lambda", "internal", "webhook"])
      .describe(
        "Execution backend. Canonical snake_case wire values matching " +
          "the Rust `ExecutionType` enum in `shared::tool_types`. Almost " +
          "always `rest_api` for new tools.",
      ),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .default("POST")
      .describe("HTTP method to call the upstream endpoint with."),
    endpoint: z
      .string()
      .url()
      .describe("Fully-qualified upstream URL the runtime POSTs to."),
    headers: z
      .record(z.string(), z.string())
      .default({})
      .describe(
        "Static headers (templated values like `{{api_key}}` are resolved at dispatch time).",
      ),
    body_template: z
      .string()
      .default("")
      .describe(
        "Optional template for the request body. Empty string means the runtime serializes the LLM-provided `tool_input` JSON verbatim (after `$caller.*` placeholder substitution).",
      ),
  })
  .passthrough()
  .describe("How the runtime calls the underlying upstream API.");

const toolAuthSchema = z
  .object({
    type: z
      .enum(["none", "api_key", "oauth2_user", "oauth2_client"])
      .default("none")
      .describe(
        "Auth strategy — canonical snake_case values matching the Rust " +
          "`AuthType` enum.",
      ),
    ssm_path: z.string().optional(),
    header_name: z.string().optional(),
  })
  .passthrough()
  .describe("Auth strategy. `None` for public APIs.");

const responseTemplateSchema = z
  .object({})
  .passthrough()
  .describe("Optional Mustache-style template applied to the upstream response.");

// ─── Tool registration ─────────────────────────────────────────────── //

export function registerToolRegistryTools(server: McpServer) {
  // ── list_tools ───────────────────────────────────────────────────── //
  server.tool(
    "list_tools",
    "List every registered tool owned by an org. Each row is a " +
      "`RegisteredTool` (see `davoxi-tool-registry-{stage}` in DDB) " +
      "that one or more specialist agents reference via `tool_refs`. " +
      "Use this to discover `tool_id`s before calling " +
      "`attach_tool_to_agent`, or to audit which tools an org has " +
      "active. Pair with `get_tool` for the full row including the " +
      "`input_schema` / `execution.endpoint` / `execution.body_template`.",
    {},
    async () => {
      try {
        const result = await davoxiFetch<unknown>("GET", `/tools`);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing tools: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_tool ─────────────────────────────────────────────────────── //
  server.tool(
    "get_tool",
    "Fetch a single registered tool by `tool_id` — returns the full " +
      "row including `input_schema`, `execution` (endpoint / method / " +
      "headers / body_template), `auth`, `response_template`, " +
      "`requires_confirmation`, `status`. This is the canonical view " +
      "the runtime executor consumes; what you see here is what gets " +
      "called when an agent invokes the tool.",
    {
      tool_id: z
        .string()
        .min(1)
        .describe(
          "The `tool_id` from `list_tools` (e.g. `tool_f3b670cd...zendit_send_topup`).",
        ),
    },
    async ({ tool_id }) => {
      try {
        const tool = await davoxiFetch<unknown>(
          "GET",
          `/tools/${enc(tool_id)}`,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(tool, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting tool: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── create_tool ──────────────────────────────────────────────────── //
  server.tool(
    "create_tool",
    "Register a new tool in the org-scoped registry. The row is " +
      "active immediately and can be attached to specialist agents via " +
      "`attach_tool_to_agent`. The backend assigns a `tool_id` of the " +
      "form `tool_<hex>` and returns the full saved row.",
    {
      name: z
        .string()
        .min(1)
        .max(100)
        .describe(
          "LLM-facing tool name (e.g. `zendit_send_topup`). This is the " +
            "string the LLM types when calling the tool, so prefer " +
            "snake_case + a stable verb_noun shape.",
        ),
      description: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "LLM-facing description. The LLM reads this to decide *when* to " +
            "call the tool — be specific about inputs, outputs, " +
            "side-effects, and what NOT to use it for.",
        ),
      category: z
        .string()
        .min(1)
        .max(100)
        .describe(
          "Free-form category tag (e.g. `payment`, `topup`, `travel`). " +
            "Used for grouping in the dashboard; does not affect routing.",
        ),
      input_schema: z
        .record(z.string(), z.unknown())
        .describe(
          "JSON Schema for the tool's input arguments. Field names here " +
            "are the canonical LLM-facing parameters; if the upstream API " +
            "uses different field names, map them via `body_template`.",
        ),
      execution: toolExecutionSchema,
      auth: toolAuthSchema.optional(),
      response_template: responseTemplateSchema.optional(),
      requires_confirmation: z.boolean().default(false),
      cost_involved: z.boolean().default(false),
      scope: z
        .enum(["org_private", "global", "marketplace"])
        .default("org_private")
        .describe(
          "Visibility scope — canonical snake_case values matching the " +
            "Rust `ToolScope` enum. `org_private` (default) keeps the " +
            "tool inside the owning org; `global` exposes it platform-" +
            "wide; `marketplace` is opt-in sharing.",
        ),
    },
    async ({
      name,
      description,
      category,
      input_schema,
      execution,
      auth,
      response_template,
      requires_confirmation,
      cost_involved,
      scope,
    }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          description,
          category,
          input_schema,
          execution,
          requires_confirmation,
          cost_involved,
          scope,
        };
        if (auth !== undefined) body.auth = auth;
        if (response_template !== undefined) {
          body.response_template = response_template;
        }
        const tool = await davoxiFetch<{ tool_id: string }>(
          "POST",
          `/tools`,
          body,
        );
        return {
          content: [
            {
              type: "text",
              text: `Created tool '${name}' as ${
                tool.tool_id
              }:\n\n${JSON.stringify(tool, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating tool: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update_tool ──────────────────────────────────────────────────── //
  server.tool(
    "update_tool",
    "Patch an existing registered tool. Only the fields you pass are " +
      "overwritten; omitted fields keep their stored value. " +
      "`tool_id`, `scope`, and `origin` are immutable on " +
      "the backend — to change those, delete + recreate. Use this to " +
      "fix LLM-facing field names in `input_schema`, retarget the " +
      "upstream `execution.endpoint`, sharpen the `description`, or " +
      "set `body_template` when the upstream API uses different " +
      "field names than the LLM-facing schema.",
    {
      tool_id: z.string().min(1),
      name: z.string().min(1).max(100).optional(),
      description: z.string().min(1).max(2000).optional(),
      category: z.string().min(1).max(100).optional(),
      input_schema: z.record(z.string(), z.unknown()).optional(),
      execution: toolExecutionSchema.optional(),
      auth: toolAuthSchema.optional(),
      response_template: responseTemplateSchema.optional(),
      requires_confirmation: z.boolean().optional(),
      status: z
        .enum(["active", "pending_review", "disabled", "auto_generated"])
        .optional()
        .describe(
          "Lifecycle status — canonical snake_case values matching the " +
            "Rust `ToolStatus` enum.",
        ),
    },
    async ({
      tool_id,
      name,
      description,
      category,
      input_schema,
      execution,
      auth,
      response_template,
      requires_confirmation,
      status,
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (category !== undefined) body.category = category;
        if (input_schema !== undefined) body.input_schema = input_schema;
        if (execution !== undefined) body.execution = execution;
        if (auth !== undefined) body.auth = auth;
        if (response_template !== undefined) {
          body.response_template = response_template;
        }
        if (requires_confirmation !== undefined) {
          body.requires_confirmation = requires_confirmation;
        }
        if (status !== undefined) body.status = status;

        if (Object.keys(body).length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No fields to update. Pass at least one of: name, description, category, input_schema, execution, auth, response_template, requires_confirmation, status.",
              },
            ],
            isError: true,
          };
        }

        const tool = await davoxiFetch<unknown>(
          "PUT",
          `/tools/${enc(tool_id)}`,
          body,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(tool, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating tool: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── delete_tool ──────────────────────────────────────────────────── //
  server.tool(
    "delete_tool",
    "Hard-delete a registered tool. The DDB row is removed immediately. " +
      "Any agent `tool_refs` pointing at the deleted `tool_id` will fail " +
      "their next dispatch with `tool_not_found` — clean up agent " +
      "attachments via `detach_tool_from_agent` first if you don't want " +
      "noisy run-time failures.",
    {
      tool_id: z.string().min(1),
    },
    async ({ tool_id }) => {
      try {
        await davoxiFetch<undefined>(
          "DELETE",
          `/tools/${enc(tool_id)}`,
        );
        return {
          content: [
            { type: "text", text: `Deleted tool ${tool_id}.` },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting tool: ${
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
