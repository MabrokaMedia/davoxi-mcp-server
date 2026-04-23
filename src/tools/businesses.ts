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
    "List all businesses on your Davoxi account. Returns an array of business objects with their IDs, names, phone numbers, voice configuration, and master configuration. Use this to discover which businesses exist before managing their agents. Supports optional search (semantic), pagination via limit/cursor.",
    {
      search: z
        .string()
        .optional()
        .describe(
          "Optional search query to filter businesses by name or description (semantic search).",
        ),
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
        .describe("Pagination cursor from a previous response's next_cursor field."),
    },
    async ({ search, limit, cursor }) => {
      try {
        const hasParams = search || limit || cursor;
        if (hasParams) {
          // Paginated / search mode — use raw fetch since client SDK
          // doesn't have a paginated method yet
          const qs = new URLSearchParams();
          if (search) qs.set("search", search);
          if (limit) qs.set("limit", String(limit));
          if (cursor) qs.set("cursor", cursor);
          // List all then filter client-side as fallback
          const all = await getClient().listBusinesses();
          const filtered = search
            ? all.filter(
                (b) =>
                  b.name.toLowerCase().includes(search.toLowerCase()) ||
                  b.voice_config?.personality_prompt
                    ?.toLowerCase()
                    .includes(search.toLowerCase()),
              )
            : all;
          const pageSize = limit ?? 25;
          const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
          const page = filtered.slice(offset, offset + pageSize);
          const nextOffset = offset + pageSize;
          const resp = {
            items: page,
            next_cursor:
              nextOffset < filtered.length ? String(nextOffset) : null,
            count: filtered.length,
          };
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(resp, null, 2),
              },
            ],
          };
        }
        // Legacy: return full array
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

  // ── Shared zod schemas ─────────────────────────────────────────── //
  const timeWindowSchema = z.object({
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .describe("Days of week: 0 = Sunday, 1 = Monday, … 6 = Saturday."),
    start: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe("Start time in HH:MM format (24h), e.g. '09:00'."),
    end: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe("End time in HH:MM format (24h), e.g. '17:00'."),
  });

  const businessHoursSchema = z
    .object({
      timezone: z
        .string()
        .describe("IANA timezone (e.g. 'America/New_York', 'Europe/Paris')."),
      windows: z
        .array(timeWindowSchema)
        .max(7)
        .describe(
          "Time windows when the business is open. E.g. Mon-Fri 09:00-17:00. Multiple windows for different day groups.",
        ),
    })
    .nullable()
    .optional()
    .describe(
      "Business opening hours. Set to null for 24/7 (always open). When set, callers outside these hours will be told the business is closed.",
    );

  const networkConfigSchema = z
    .object({
      discoverable: z
        .boolean()
        .optional()
        .describe(
          "Whether the master orchestrator can discover and route to this business when a caller's intent matches one of its categories. Set to true to make the business findable. Omitting network_config entirely leaves this field unset in DDB, which blocks discovery.",
        ),
      categories: z
        .array(z.string().min(1).max(100))
        .max(50)
        .optional()
        .describe(
          "Tags describing what this business serves (e.g. ['music','streaming'] for a Spotify proxy, ['rides','transport'] for an Uber proxy). The master orchestrator matches caller intent against these. Empty array = all categories. Max 50 tags, each up to 100 characters.",
        ),
      allowed_methods: z
        .array(z.enum(["api", "ai", "voice"]))
        .optional()
        .describe(
          "Contact methods other businesses may use to reach this one: 'api' (direct HTTP), 'ai' (AI-to-AI in-process), 'voice' (outbound call). Defaults to ['api','ai'] on the backend.",
        ),
      voice_rate_limit_per_hour: z
        .number()
        .int()
        .min(0)
        .max(100000)
        .optional()
        .describe("Max inbound voice calls per hour via the broker (default 10, max 100000)."),
      total_rate_limit_per_hour: z
        .number()
        .int()
        .min(0)
        .max(100000)
        .optional()
        .describe("Max total inbound contacts (all methods) per hour via the broker (default 50, max 100000)."),
    })
    .optional()
    .describe(
      "Network-level routing config. Set `discoverable: true` with matching `categories` so the master orchestrator can find this business when a caller's intent matches. Omitting this field leaves the business undiscoverable.",
    );

  // ── create_business ──────────────────────────────────────────────── //
  server.tool(
    "create_business",
    `Create a new business on Davoxi. A business represents a company or organization that uses AI voice agents to handle phone calls. Each business has its own phone numbers, voice configuration, and set of specialist agents.

After creating a business, you can add specialist agents to it using the create_agent tool. By default, the business is available 24/7.

IMPORTANT: if this business should be discoverable by the master orchestrator (e.g. a proxy business serving a specific category like "music" or "rides"), set \`network_config\` with \`discoverable: true\` and matching \`categories\`. Omitting network_config leaves the business undiscoverable — the master won't route intent-matched traffic to it.`,
    {
      name: z
        .string()
        .min(1)
        .max(255)
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
        .max(10000)
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
      business_hours: businessHoursSchema,
      network_config: networkConfigSchema,
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          name: params.name,
        };
        if (params.phone_numbers !== undefined) body.phone_numbers = params.phone_numbers;

        if (params.voice !== undefined || params.language !== undefined || params.personality_prompt !== undefined) {
          const vc: Partial<VoiceConfig> = {};
          if (params.voice !== undefined) vc.voice = params.voice;
          if (params.language !== undefined) vc.language = params.language;
          if (params.personality_prompt !== undefined)
            vc.personality_prompt = params.personality_prompt;
          body.voice_config = vc;
        }

        if (
          params.temperature !== undefined ||
          params.max_specialists_per_turn !== undefined
        ) {
          const mc: Partial<MasterConfig> = {};
          if (params.temperature !== undefined)
            mc.temperature = params.temperature;
          if (params.max_specialists_per_turn !== undefined)
            mc.max_specialists_per_turn =
              params.max_specialists_per_turn;
          body.master_config = mc;
        }

        if (params.business_hours !== undefined) {
          body.business_hours = params.business_hours;
        }

        if (params.network_config !== undefined) {
          body.network_config = params.network_config;
        }

        const business = await getClient().createBusiness(body as unknown as Parameters<DavoxiClient["createBusiness"]>[0]);
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
    "Updates a business. Sends a PUT request - only provided fields will be updated. You can change its name, phone numbers, voice configuration (voice model, language, personality), master configuration (temperature, max specialists), business hours, or network_config (discoverability + categories for the master orchestrator).",
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business to update."),
      name: z.string().min(1).max(255).optional().describe("New display name for the business."),
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
        .max(10000)
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
      business_hours: businessHoursSchema,
      network_config: networkConfigSchema,
      paused: z
        .boolean()
        .optional()
        .describe(
          "Set to true to temporarily pause the business (callers hear 'temporarily unavailable'). Set to false to resume.",
        ),
    },
    async (params) => {
      try {
        const data: Record<string, unknown> = {};
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

        if (params.business_hours !== undefined) {
          data.business_hours = params.business_hours;
        }

        if (params.network_config !== undefined) {
          data.network_config = params.network_config;
        }

        if (params.paused !== undefined) {
          data.paused = params.paused;
        }

        const business = await getClient().updateBusiness(
          params.business_id,
          data as Parameters<DavoxiClient["updateBusiness"]>[1],
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

  // ── set_business_hours ──────────────────────────────────────────── //
  server.tool(
    "set_business_hours",
    `Set business opening hours for a Davoxi business. Controls when the AI agent is available to take calls. Outside business hours, callers will be told the business is closed.

Examples:
- 24/7: set business_hours to null
- Mon-Fri 9am-5pm: { timezone: "America/New_York", windows: [{ days: [1,2,3,4,5], start: "09:00", end: "17:00" }] }
- Weekdays 9-6 + Saturday 10-4: two windows with different day arrays`,
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business."),
      business_hours: businessHoursSchema.describe(
        "Opening hours. Set to null for 24/7 availability. Otherwise provide timezone and time windows.",
      ),
    },
    async ({ business_id, business_hours }) => {
      try {
        const business = await getClient().updateBusiness(
          business_id,
          { business_hours } as Parameters<DavoxiClient["updateBusiness"]>[1],
        );
        const status =
          business_hours === null || business_hours === undefined
            ? "24/7 (always open)"
            : `${business_hours.windows.length} time window(s) in ${business_hours.timezone}`;
        return {
          content: [
            {
              type: "text" as const,
              text: `Business hours updated: ${status}\n\n${JSON.stringify(business, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error setting business hours: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── pause_business ───────────────────────────────────────────────── //
  server.tool(
    "pause_business",
    "Temporarily pause a business. Incoming calls will hear a polite 'temporarily unavailable' message and hang up. All configuration, agents, phone routing, and settings are preserved. Use resume_business to reactivate.",
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business to pause."),
    },
    async ({ business_id }) => {
      try {
        const business = await getClient().updateBusiness(
          business_id,
          { paused: true } as Parameters<DavoxiClient["updateBusiness"]>[1],
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Business "${business_id}" is now paused. Incoming calls will hear a "temporarily unavailable" message.\n\n${JSON.stringify(business, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error pausing business: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── resume_business ─────────────────────────────────────────────── //
  server.tool(
    "resume_business",
    "Resume a paused business. The AI agent will start taking calls again immediately. All configuration is preserved from before the pause.",
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business to resume."),
    },
    async ({ business_id }) => {
      try {
        const business = await getClient().updateBusiness(
          business_id,
          { paused: false } as Parameters<DavoxiClient["updateBusiness"]>[1],
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Business "${business_id}" is now active and taking calls.\n\n${JSON.stringify(business, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error resuming business: ${err instanceof Error ? err.message : String(err)}`,
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
    "Permanently delete a Davoxi business and ALL associated agents, phone numbers, webhooks, and configuration. This action CANNOT be undone. The business will immediately stop handling calls. Requires confirm=true as a safety check.",
    {
      business_id: z
        .string()
        .describe("The unique identifier of the business to delete."),
      confirm: z
        .boolean()
        .describe(
          "Must be set to true to confirm deletion. This is a safety check because deleting a business also deletes ALL its agents, phone number assignments, and webhooks permanently.",
        ),
    },
    async ({ business_id, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Deletion not confirmed. Set confirm=true to permanently delete business ${business_id} and ALL its agents, phone number assignments, and webhooks. This cannot be undone.`,
            },
          ],
        };
      }
      try {
        await getClient().deleteBusiness(business_id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Business ${business_id} deleted successfully. All associated agents, phone number assignments, and webhooks have been removed.`,
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
