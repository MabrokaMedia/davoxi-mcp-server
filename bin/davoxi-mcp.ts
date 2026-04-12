#!/usr/bin/env node

/**
 * Davoxi MCP Server — executable entry point.
 *
 * Usage:
 *   npx @davoxi/mcp-server               — start the MCP server
 *   npx @davoxi/mcp-server auth login     — authenticate via browser
 *   npx @davoxi/mcp-server auth logout    — clear saved credentials
 *   npx @davoxi/mcp-server auth status    — show current auth state
 *
 * Environment variables:
 *   DAVOXI_API_KEY  (optional) — Your Davoxi API key (starts with sk_)
 *   DAVOXI_API_URL  (optional) — API base URL (default: https://api.davoxi.com)
 */

import { main } from "../src/index.js";
import { handleAuthCommand } from "../src/auth/cli.js";

// Handle "auth" subcommand before starting the MCP server
if (process.argv[2] === "auth") {
  handleAuthCommand(process.argv.slice(3))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    });
} else {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal error starting Davoxi MCP server: ${message}\n`);
    process.exit(1);
  });
}
