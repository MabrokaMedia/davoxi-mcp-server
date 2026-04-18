/**
 * Davoxi MCP Server
 *
 * Model Context Protocol server for the Davoxi AI voice agent platform.
 * Exposes tools for managing businesses, specialist agents, usage analytics,
 * billing, and API keys via stdio transport.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DavoxiClient } from "@davoxi/client";
import { registerBusinessTools } from "./tools/businesses.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerAccountTools } from "./tools/account.js";
import { registerCallTools } from "./tools/calls.js";
import { registerWebhookTools } from "./tools/webhooks.js";
import { registerPhoneTools } from "./tools/phones.js";
import { registerCallerTools } from "./tools/callers.js";
import { registerCredentialTools } from "./tools/credentials.js";
import { registerToolRefTools } from "./tools/tool-refs.js";
import { loadMcpCredentials } from "./auth/credentials.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Try multiple relative paths to support both source (src/) and compiled (dist/src/) layouts
let pkg: { name: string; version: string } = { name: "davoxi-mcp", version: "0.0.0" };
for (const rel of ["../../package.json", "../package.json"]) {
  try {
    pkg = JSON.parse(readFileSync(join(__dirname, rel), "utf-8"));
    break;
  } catch {
    // try next path
  }
}

/**
 * Resolve the API key from environment variable or saved credentials.
 * Priority: DAVOXI_API_KEY env var → ~/.davoxi/mcp.json → throw
 */
function resolveApiKey(): string {
  const envKey = process.env.DAVOXI_API_KEY;
  if (envKey) return envKey;

  const saved = loadMcpCredentials();
  if (saved?.api_key) return saved.api_key;

  throw new Error(
    "No API key found. Run 'npx @davoxi/mcp-server auth login' to authenticate via browser, " +
      "or set the DAVOXI_API_KEY environment variable.",
  );
}

/**
 * Validate that a URL string is an acceptable API base URL.
 * Accepts https:// for any host, and http://localhost or http://127.0.0.1 for
 * local development. Throws with a helpful message if the value is invalid.
 */
export function validateApiUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `DAVOXI_API_URL is not a valid URL: "${raw}". ` +
        `Expected an https:// URL (e.g. https://api.davoxi.com) ` +
        `or http://localhost for local development.`,
    );
  }

  const isHttps = parsed.protocol === "https:";
  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

  if (!isHttps && !isLocalHttp) {
    throw new Error(
      `DAVOXI_API_URL must be an https:// URL or http://localhost, got: "${raw}".`,
    );
  }

  return raw;
}

export function createServer(): McpServer {
  const apiKey = resolveApiKey();
  const rawApiUrl = process.env.DAVOXI_API_URL;
  const apiUrl = rawApiUrl !== undefined ? validateApiUrl(rawApiUrl) : undefined;

  const client = new DavoxiClient({ apiKey, apiUrl });
  const getClient = () => client;

  const server = new McpServer({
    name: "davoxi",
    version: pkg.version,
    description:
      "MCP server for the Davoxi AI voice agent platform. " +
      "Manage businesses, specialist agents, usage analytics, billing, and API keys.",
  });

  // Register all tool groups
  registerBusinessTools(server, getClient);
  registerAgentTools(server, getClient);
  registerCallTools(server, getClient);
  registerCallerTools(server, {
    apiKey,
    apiUrl: apiUrl ?? "https://api.davoxi.com",
  });
  registerWebhookTools(server, getClient);
  registerPhoneTools(server, getClient);
  registerAnalyticsTools(server, getClient);
  registerAccountTools(server, getClient);
  registerCredentialTools(server, getClient);
  registerToolRefTools(server, getClient);

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Graceful shutdown
  const shutdown = async () => {
    await server.close().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
