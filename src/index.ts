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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Try multiple relative paths to support both source (src/) and compiled (dist/src/) layouts
let pkg: { name?: string; version?: string } = { name: "davoxi-mcp", version: "0.0.0" };
for (const rel of ["../../package.json", "../package.json"]) {
  try {
    pkg = JSON.parse(readFileSync(join(__dirname, rel), "utf-8"));
    break;
  } catch {
    // try next path
  }
}

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
  const apiKey = getEnvOrThrow("DAVOXI_API_KEY");
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
