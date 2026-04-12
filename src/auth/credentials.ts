/**
 * Credential file management for Davoxi MCP Server.
 *
 * Stores the API key in ~/.davoxi/mcp.json (separate from the CLI's config.json).
 * File permissions are set to 0o600 (owner read/write only).
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface McpCredentials {
  api_key: string;
  api_url?: string;
  created_at: string;
}

const CONFIG_DIR = join(homedir(), ".davoxi");
const CREDENTIALS_FILE = join(CONFIG_DIR, "mcp.json");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } else {
    try {
      chmodSync(CONFIG_DIR, 0o700);
    } catch {
      // On Windows, chmod is a no-op for some bits — ignore errors
    }
  }
}

export function loadMcpCredentials(): McpCredentials | null {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
      const parsed = JSON.parse(raw) as McpCredentials;
      if (parsed.api_key && typeof parsed.api_key === "string") {
        return parsed;
      }
    }
  } catch {
    // Corrupted file — return null
  }
  return null;
}

export function saveMcpCredentials(creds: McpCredentials): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function deleteMcpCredentials(): boolean {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      unlinkSync(CREDENTIALS_FILE);
      return true;
    }
  } catch {
    // Ignore — file may not exist
  }
  return false;
}

export function getMcpCredentialsPath(): string {
  return CREDENTIALS_FILE;
}
