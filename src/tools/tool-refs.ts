/**
 * MCP tools for managing an agent's `tool_refs` — the tools-SSOT
 * attachment between a specialist agent and a registered tool in
 * `davoxi-tool-registry-{stage}`.
 *
 * Workflow:
 *   1. Customer creates a tool via `create_tool` (existing /tools endpoint)
 *      or picks an existing one via `list_tools`.
 *   2. Customer attaches it to a specific agent via `attach_tool_to_agent`.
 *   3. The runtime resolves the ref at dispatch time — endpoint, input
 *      schema, and auth all flow from the registry row, not from a copy
 *      embedded on the agent.
 *
 * This replaces the older pattern of embedding a `ToolDefinition` into
 * `AgentDefinition.tools` directly. That path still works as a fallback
 * during the migration window.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

export function registerToolRefTools(
  server: McpServer,
  getClient: () => DavoxiClient,
) {
  // ── attach_tool_to_agent ─────────────────────────────────────────── //
  server.tool(
    "attach_tool_to_agent",
    "Attach an existing registered tool to a specialist agent. The tool " +
      "must already exist in the tool-registry (use `list_tools` to find " +
      "tool_ids). The runtime resolves the registered tool's endpoint, " +
      "input schema, and auth config at dispatch time — a much cleaner " +
      "pattern than embedding a full tool definition onto the agent. " +
      "Idempotent: attaching the same tool_id again updates the " +
      "`requires_confirmation_override` in place without creating a " +
      "duplicate entry.",
    {
      business_id: z
        .string()
        .min(1)
        .describe("The owning business's id."),
      agent_id: z
        .string()
        .min(1)
        .describe("The agent to attach the tool to."),
      tool_id: z
        .string()
        .min(1)
        .describe(
          "The tool_id from the registry. Must exist — 404 is returned " +
            "if the tool isn't in the registry.",
        ),
      requires_confirmation_override: z
        .boolean()
        .optional()
        .describe(
          "Optional per-agent override of the registered tool's " +
            "`requires_confirmation` flag. Use this to force a confirmation " +
            "prompt on an agent even if the registered tool doesn't require " +
            "one globally (or the other way around). Omit to inherit the " +
            "registry value.",
        ),
    },
    async ({
      business_id,
      agent_id,
      tool_id,
      requires_confirmation_override,
    }) => {
      try {
        const result = await getClient().attachToolRef(
          business_id,
          agent_id,
          tool_id,
          requires_confirmation_override !== undefined
            ? { requires_confirmation_override }
            : undefined,
        );
        const action = result.replaced
          ? "Updated existing tool_ref"
          : "Attached new tool_ref";
        return {
          content: [
            {
              type: "text",
              text:
                `${action}. Agent ${result.agent_id} now has ` +
                `${result.tool_refs.length} tool_refs attached:\n` +
                result.tool_refs
                  .map(
                    (r) =>
                      `  - ${r.tool_id}${r.requires_confirmation_override !== null && r.requires_confirmation_override !== undefined ? ` (override=${r.requires_confirmation_override})` : ""}`,
                  )
                  .join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error attaching tool: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── detach_tool_from_agent ───────────────────────────────────────── //
  server.tool(
    "detach_tool_from_agent",
    "Remove a tool_ref from a specialist agent's attached-tools list. " +
      "Idempotent — returns 200 whether or not the ref was present; the " +
      "`removed` field indicates whether the list actually changed. Does " +
      "NOT delete the registered tool itself; use `delete_tool` for that.",
    {
      business_id: z.string().min(1).describe("The owning business's id."),
      agent_id: z.string().min(1).describe("The agent to detach from."),
      tool_id: z
        .string()
        .min(1)
        .describe("The tool_id to remove from the agent's tool_refs."),
    },
    async ({ business_id, agent_id, tool_id }) => {
      try {
        const result = await getClient().detachToolRef(
          business_id,
          agent_id,
          tool_id,
        );
        return {
          content: [
            {
              type: "text",
              text: result.removed
                ? `Detached tool_ref ${tool_id} from agent ${agent_id}.`
                : `tool_ref ${tool_id} was not attached to agent ${agent_id} (no-op).`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error detaching tool: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── list_agent_tool_refs ─────────────────────────────────────────── //
  server.tool(
    "list_agent_tool_refs",
    "List the `tool_refs` currently attached to a specialist agent. " +
      "Each ref is a pointer to a row in the tool-registry; use " +
      "`list_tools` to look up the details of each tool_id. Returns an " +
      "empty list when the agent is still on the legacy embedded-tools " +
      "path (check `list_agents` for `tools: [...]` in that case).",
    {
      business_id: z.string().min(1).describe("The owning business's id."),
      agent_id: z.string().min(1).describe("The agent to inspect."),
    },
    async ({ business_id, agent_id }) => {
      try {
        const agent = await getClient().getAgent(business_id, agent_id);
        const refs = agent.tool_refs ?? [];
        if (refs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Agent ${agent_id} has no tool_refs attached.` +
                  (agent.tools && agent.tools.length > 0
                    ? ` It's still on the legacy embedded-tools path ` +
                      `(${agent.tools.length} tool${agent.tools.length === 1 ? "" : "s"} in \`tools\`).`
                    : ""),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text:
                `Agent ${agent_id} has ${refs.length} tool_ref${refs.length === 1 ? "" : "s"}:\n` +
                refs
                  .map(
                    (r) =>
                      `  - ${r.tool_id}${r.requires_confirmation_override !== null && r.requires_confirmation_override !== undefined ? ` (override=${r.requires_confirmation_override})` : ""}`,
                  )
                  .join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing tool_refs: ${
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
