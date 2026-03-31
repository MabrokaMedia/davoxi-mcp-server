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
import { DavoxiClient } from "./client.js";
import { registerBusinessTools } from "./tools/businesses.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerAccountTools } from "./tools/account.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it before starting the server (e.g. export ${name}=sk_...).`,
    );
  }
  return value;
}

export function createServer(): McpServer {
  const apiKey = getEnvOrThrow("DAVOXI_API_KEY");
  const apiUrl = process.env.DAVOXI_API_URL;

  const client = new DavoxiClient(apiKey, apiUrl);
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
  registerAnalyticsTools(server, getClient);
  registerAccountTools(server, getClient);

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
