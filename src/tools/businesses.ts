/**
 * MCP tools for managing Davoxi businesses.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DavoxiClient, VoiceConfig, MasterConfig } from "@davoxi/client";

export function registerBusinessTools(
  server: McpServer,
  getClient: () => DavoxiClient,
): void {
  // ── list_businesses ──────────────────────────────────────────────── //
  server.tool(
    "list_businesses",
    "List all businesses on your Davoxi account. Returns an array of business objects with their IDs, names, phone numbers, voice configuration, and master configuration. Use this to discover which businesses exist before managing their agents.",
    {},
    async () => {
      try {
        const businesses = await getClient().listBusinesses();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(businesses, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing businesses: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get_business ─────────────────────────────────────────────────── //
  server.tool(
    "get_business",
    "Get detailed information about a specific Davoxi business by its ID. Returns the full business object including voice config (voice model, language, personality prompt), master config (temperature, max specialists per turn), phone numbers, and timestamps.",
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business to retrieve."),
    },
    async ({ business_id }) => {
      try {
        const business = await getClient().getBusiness(business_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(business, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting business: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── create_business ──────────────────────────────────────────────── //
  server.tool(
    "create_business",
    `Create a new business on Davoxi. A business represents a company or organization that uses AI voice agents to handle phone calls. Each business has its own phone numbers, voice configuration, and set of specialist agents.

After creating a business, you can add specialist agents to it using the create_agent tool.`,
    {
      name: z
        .string()
        .describe("The display name of the business (e.g. 'Acme Corp')."),
      phone_numbers: z
        .array(z.string())
        .optional()
        .describe(
          "Phone numbers to assign to this business in E.164 format (e.g. ['+15551234567']). These are the numbers callers will dial to reach the AI voice agent.",
        ),
      voice: z
        .string()
        .optional()
        .describe(
          "Voice model for the AI agent. Options include 'alloy', 'shimmer', 'echo', 'fable', 'onyx', 'nova'. Default depends on the platform.",
        ),
      language: z
        .string()
        .optional()
        .describe(
          "Language for the AI agent in BCP-47 format (e.g. 'en-US', 'es-ES', 'fr-FR'). Determines speech recognition and synthesis language.",
        ),
      personality_prompt: z
        .string()
        .optional()
        .describe(
          "A prompt that defines the AI agent's personality and speaking style. E.g. 'You are a friendly and professional customer service representative.'",
        ),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe(
          "Controls randomness in AI responses. 0 = deterministic, 1 = balanced, 2 = very creative. Default is typically around 0.7.",
        ),
      max_specialists_per_turn: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Maximum number of specialist agents that can be invoked in a single conversation turn. Higher values allow more complex multi-step handling.",
        ),
    },
    async (params) => {
      try {
        const body: Parameters<DavoxiClient["createBusiness"]>[0] = {
          name: params.name,
        };
        if (params.phone_numbers !== undefined) body.phone_numbers = params.phone_numbers;

        if (params.voice !== undefined || params.language !== undefined || params.personality_prompt !== undefined) {
          body.voice_config = {};
          if (params.voice !== undefined) body.voice_config.voice = params.voice;
          if (params.language !== undefined) body.voice_config.language = params.language;
          if (params.personality_prompt !== undefined)
            body.voice_config.personality_prompt = params.personality_prompt;
        }

        if (
          params.temperature !== undefined ||
          params.max_specialists_per_turn !== undefined
        ) {
          body.master_config = {};
          if (params.temperature !== undefined)
            body.master_config.temperature = params.temperature;
          if (params.max_specialists_per_turn !== undefined)
            body.master_config.max_specialists_per_turn =
              params.max_specialists_per_turn;
        }

        const business = await getClient().createBusiness(body);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(business, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating business: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update_business ──────────────────────────────────────────────── //
  server.tool(
    "update_business",
    "Updates a business. Sends a PUT request - only provided fields will be updated. You can change its name, phone numbers, voice configuration (voice model, language, personality), or master configuration (temperature, max specialists).",
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business to update."),
      name: z.string().optional().describe("New display name for the business."),
      phone_numbers: z
        .array(z.string())
        .optional()
        .describe(
          "Updated list of phone numbers in E.164 format. This replaces the entire list.",
        ),
      voice: z
        .string()
        .optional()
        .describe("New voice model (e.g. 'alloy', 'shimmer')."),
      language: z
        .string()
        .optional()
        .describe("New language in BCP-47 format (e.g. 'en-US')."),
      personality_prompt: z
        .string()
        .optional()
        .describe("New personality prompt for the voice agent."),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("New temperature value (0-2)."),
      max_specialists_per_turn: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("New max specialists per turn."),
    },
    async (params) => {
      try {
        const data: Parameters<DavoxiClient["updateBusiness"]>[1] = {};
        if (params.name !== undefined) data.name = params.name;
        if (params.phone_numbers !== undefined) data.phone_numbers = params.phone_numbers;

        if (params.voice !== undefined || params.language !== undefined || params.personality_prompt !== undefined) {
          const vc: Partial<VoiceConfig> = {};
          if (params.voice !== undefined) vc.voice = params.voice;
          if (params.language !== undefined) vc.language = params.language;
          if (params.personality_prompt !== undefined) vc.personality_prompt = params.personality_prompt;
          data.voice_config = vc;
        }

        if (
          params.temperature !== undefined ||
          params.max_specialists_per_turn !== undefined
        ) {
          const mc: Partial<MasterConfig> = {};
          if (params.temperature !== undefined) mc.temperature = params.temperature;
          if (params.max_specialists_per_turn !== undefined) mc.max_specialists_per_turn = params.max_specialists_per_turn;
          data.master_config = mc;
        }

        const business = await getClient().updateBusiness(
          params.business_id,
          data,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(business, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating business: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── delete_business ──────────────────────────────────────────────── //
  server.tool(
    "delete_business",
    "Permanently delete a Davoxi business and all its associated agents, phone numbers, and configuration. This action cannot be undone. The business will immediately stop handling calls.",
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business to delete."),
    },
    async ({ business_id }) => {
      try {
        await getClient().deleteBusiness(business_id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Business ${business_id} deleted successfully.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting business: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
