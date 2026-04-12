/**
 * Auth subcommand handler for the Davoxi MCP CLI.
 *
 * Usage:
 *   npx @davoxi/mcp-server auth login    — authenticate via browser
 *   npx @davoxi/mcp-server auth logout   — clear saved credentials
 *   npx @davoxi/mcp-server auth status   — show current auth state
 */

import { DavoxiClient } from "@davoxi/client";
import {
  loadMcpCredentials,
  saveMcpCredentials,
  deleteMcpCredentials,
  getMcpCredentialsPath,
} from "./credentials.js";
import { browserLogin } from "./browser-login.js";

function stderr(msg: string): void {
  process.stderr.write(msg + "\n");
}

async function login(): Promise<void> {
  try {
    const apiKey = await browserLogin();

    saveMcpCredentials({
      api_key: apiKey,
      created_at: new Date().toISOString(),
    });

    stderr("");
    stderr("  Authenticated successfully!");
    stderr(`  Credentials saved to ${getMcpCredentialsPath()}`);
    stderr("");
    stderr("  You can now use the MCP server without setting DAVOXI_API_KEY.");
    stderr("");
  } catch (err) {
    stderr(
      `  Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

async function logout(): Promise<void> {
  const removed = deleteMcpCredentials();
  if (removed) {
    stderr("  Credentials removed.");
  } else {
    stderr("  No saved credentials found.");
  }
}

async function status(): Promise<void> {
  // Check env var first
  const envKey = process.env.DAVOXI_API_KEY;
  if (envKey) {
    stderr(`  Authenticated via DAVOXI_API_KEY environment variable.`);
    stderr(`  Key prefix: ${envKey.slice(0, 8)}...`);

    try {
      const client = new DavoxiClient({ apiKey: envKey });
      const profile = await client.getProfile();
      stderr(`  Account: ${profile.email}${profile.name ? ` (${profile.name})` : ""}`);
    } catch {
      stderr("  (Could not verify key — the API may be unreachable)");
    }
    return;
  }

  // Check saved credentials
  const creds = loadMcpCredentials();
  if (creds) {
    stderr(`  Authenticated via saved credentials.`);
    stderr(`  Key prefix: ${creds.api_key.slice(0, 8)}...`);
    stderr(`  Saved at: ${creds.created_at}`);
    stderr(`  File: ${getMcpCredentialsPath()}`);

    try {
      const client = new DavoxiClient({ apiKey: creds.api_key, apiUrl: creds.api_url });
      const profile = await client.getProfile();
      stderr(`  Account: ${profile.email}${profile.name ? ` (${profile.name})` : ""}`);
    } catch {
      stderr("  (Could not verify key — the API may be unreachable or the key was revoked)");
    }
    return;
  }

  stderr("  Not authenticated.");
  stderr("");
  stderr("  Run 'npx @davoxi/mcp-server auth login' to authenticate via browser,");
  stderr("  or set the DAVOXI_API_KEY environment variable.");
}

function printUsage(): void {
  stderr("");
  stderr("  Usage: npx @davoxi/mcp-server auth <command>");
  stderr("");
  stderr("  Commands:");
  stderr("    login    Authenticate via browser (opens Davoxi dashboard)");
  stderr("    logout   Clear saved credentials");
  stderr("    status   Show current authentication state");
  stderr("");
}

export async function handleAuthCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "login":
      await login();
      break;
    case "logout":
      await logout();
      break;
    case "status":
      await status();
      break;
    default:
      printUsage();
      if (subcommand && subcommand !== "--help" && subcommand !== "-h") {
        stderr(`  Unknown command: ${subcommand}`);
        process.exit(1);
      }
      break;
  }
}
