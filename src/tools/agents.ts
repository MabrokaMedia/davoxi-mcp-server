/**
 * MCP tools for managing Davoxi specialist agents.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient } from "@davoxi/client";

const toolDefinitionSchema = z.object({
  name: z.string().min(1).max(100).describe("The tool name, used as an identifier (e.g. 'book_appointment')."),
  description: z.string().min(1).max(1000).describe("Human-readable description of what this tool does, shown to the AI so it knows when to invoke it."),
  parameters: z.record(z.unknown()).describe("JSON Schema describing the tool's parameters."),
  endpoint: z.string().url().describe("The HTTP endpoint to call when this tool is invoked (e.g. 'https://api.example.com/book')."),
  auth_ssm_path: z.string().min(1).max(500).describe("AWS SSM Parameter Store path containing the API key or auth token for this endpoint."),
  requires_confirmation: z.boolean().describe("If true, the AI will ask the caller to confirm before executing this tool (recommended for actions with side effects like bookings or payments)."),
});

export function registerAgentTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── list_agents ──────────────────────────────────────────────────── //
  server.tool(
    "list_agents",
    "List all specialist agents for a given Davoxi business. Each agent is a specialist sub-agent that handles a specific type of task during a voice call (e.g. appointment booking, FAQ answering, order lookup). Returns agent IDs, descriptions, system prompts, tools, stats, and enabled status.",
    {
      business_id: z
        .string()
        .describe(
          "The unique identifier of the business whose agents to list. Use list_businesses first if you don't know the ID.",
        ),
    },
    async ({ business_id }) => {
      try {
        const agents = await getClient().listAgents(business_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(agents, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing agents: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_agent ────────────────────────────────────────────────────── //
  server.tool(
    "get_agent",
    "Get detailed information about a specific specialist agent by business ID and agent ID. Returns the full agent object including description, system prompt, tools, knowledge sources, trigger tags, enabled status, and stats.",
    {
      business_id: z
        .string()
        .describe(
          "The unique identifier of the business that owns the agent.",
        ),
      agent_id: z
        .string()
        .describe("The unique identifier of the agent to retrieve."),
    },
    async ({ business_id, agent_id }) => {
      try {
        const agent = await getClient().getAgent(business_id, agent_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(agent, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting agent: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── create_agent ─────────────────────────────────────────────────── //
  server.tool(
    "create_agent",
    `Create a new specialist agent within a Davoxi business.

Agents are specialist sub-agents that the master AI voice agent delegates to during a phone call. When a caller's request matches an agent's expertise, the master agent hands off to that specialist. Think of them like departments in a company — one agent handles appointment booking, another handles billing questions, another handles technical support, etc.

Each agent has:
- A description (tells the master agent what this specialist does)
- A system prompt (detailed instructions for how the specialist should behave)
- Optional tools (external API integrations the specialist can call, like a CRM or booking system)
- Optional knowledge sources (documents or URLs the specialist can reference)
- Trigger tags (keywords or intents that cause the master to route to this specialist)

Example: An appointment-booking agent might have a system prompt like "You help callers schedule, reschedule, or cancel appointments. Always confirm the date and time before booking." with a tool that calls a calendar API.`,
    {
      business_id: z
        .string()
        .describe("The business ID to create the agent under."),
      description: z
        .string()
        .min(1)
        .max(500)
        .describe(
          "A concise description of what this specialist agent does. This is shown to the master agent so it knows when to delegate to this specialist. E.g. 'Handles appointment scheduling and rescheduling requests.'",
        ),
      system_prompt: z
        .string()
        .min(1)
        .max(50000)
        .describe(
          "Detailed instructions that define how this specialist agent behaves during a call. Include tone, rules, what information to collect, and how to handle edge cases. This is the core 'personality' and 'knowledge' of the specialist.",
        ),
      tools: z
        .array(toolDefinitionSchema)
        .optional()
        .describe(
          "External tool integrations this agent can invoke during a call. Each tool has an HTTP endpoint, parameter schema, and auth config. Use these to connect the agent to your CRM, booking system, knowledge base, etc.",
        ),
      knowledge_sources: z
        .array(z.string().url())
        .max(20)
        .optional()
        .describe(
          "URLs or document identifiers the agent can reference for answering questions. E.g. ['https://docs.example.com/faq', 's3://my-bucket/product-manual.pdf'].",
        ),
      trigger_tags: z
        .array(z.string().min(1).max(100))
        .max(50)
        .optional()
        .describe(
          "Keywords or intent labels that cause the master agent to route a caller to this specialist. E.g. ['appointment', 'schedule', 'booking', 'reschedule', 'cancel appointment'].",
        ),
      enabled: z
        .boolean()
        .optional()
        .describe(
          "Whether this agent is active and available for routing. Defaults to true. Set to false to disable without deleting.",
        ),
    },
    async (params) => {
      try {
        const body: Parameters<DavoxiClient["createAgent"]>[1] = {
          description: params.description,
          system_prompt: params.system_prompt,
        };
        if (params.tools !== undefined) body.tools = params.tools;
        if (params.knowledge_sources !== undefined)
          body.knowledge_sources = params.knowledge_sources;
        if (params.trigger_tags !== undefined) body.trigger_tags = params.trigger_tags;
        if (params.enabled !== undefined) body.enabled = params.enabled;

        const agent = await getClient().createAgent(params.business_id, body);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(agent, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating agent: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update_agent ─────────────────────────────────────────────────── //
  server.tool(
    "update_agent",
    "Updates a specialist agent's configuration. Sends a PUT request - only provided fields will be updated. You can change its description, system prompt, tools, knowledge sources, trigger tags, or enabled status.",
    {
      business_id: z
        .string()
        .describe("The business ID that owns the agent."),
      agent_id: z
        .string()
        .describe("The unique identifier of the agent to update."),
      description: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("New description of what the specialist does."),
      system_prompt: z
        .string()
        .min(1)
        .max(50000)
        .optional()
        .describe("New system prompt / instructions for the specialist."),
      tools: z
        .array(toolDefinitionSchema)
        .optional()
        .describe(
          "Updated list of tool integrations. This replaces the entire tools list.",
        ),
      knowledge_sources: z
        .array(z.string().url())
        .max(20)
        .optional()
        .describe("Updated knowledge source URLs/IDs. Replaces the entire list."),
      trigger_tags: z
        .array(z.string().min(1).max(100))
        .max(50)
        .optional()
        .describe("Updated trigger tags. Replaces the entire list."),
      enabled: z
        .boolean()
        .optional()
        .describe("Set to false to disable the agent, true to re-enable."),
    },
    async (params) => {
      try {
        const data: Parameters<DavoxiClient["updateAgent"]>[2] = {};
        if (params.description !== undefined)
          data.description = params.description;
        if (params.system_prompt !== undefined)
          data.system_prompt = params.system_prompt;
        if (params.tools !== undefined) data.tools = params.tools;
        if (params.knowledge_sources !== undefined)
          data.knowledge_sources = params.knowledge_sources;
        if (params.trigger_tags !== undefined)
          data.trigger_tags = params.trigger_tags;
        if (params.enabled !== undefined) data.enabled = params.enabled;

        const agent = await getClient().updateAgent(
          params.business_id,
          params.agent_id,
          data,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(agent, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating agent: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── delete_agent ─────────────────────────────────────────────────── //
  server.tool(
    "delete_agent",
    "Permanently delete a specialist agent from a business. The agent will immediately stop handling calls. This cannot be undone.",
    {
      business_id: z
        .string()
        .describe("The business ID that owns the agent."),
      agent_id: z
        .string()
        .describe("The unique identifier of the agent to delete."),
    },
    async ({ business_id, agent_id }) => {
      try {
        await getClient().deleteAgent(business_id, agent_id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent ${agent_id} deleted successfully from business ${business_id}.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting agent: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
