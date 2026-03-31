#!/usr/bin/env node

/**
 * Davoxi MCP Server — executable entry point.
 *
 * Usage:
 *   DAVOXI_API_KEY=sk_... npx davoxi-mcp
 *
 * Environment variables:
 *   DAVOXI_API_KEY  (required) — Your Davoxi API key (starts with sk_)
 *   DAVOXI_API_URL  (optional) — API base URL (default: https://api.davoxi.com)
 */

import { main } from "../src/index.js";

main().catch((err: unknown) => {
  console.error("Fatal error starting Davoxi MCP server:", err);
  process.exit(1);
});
