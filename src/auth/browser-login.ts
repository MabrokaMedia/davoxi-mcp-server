/**
 * Browser-based login flow for Davoxi MCP Server.
 *
 * Opens the user's browser to the Davoxi dashboard authorization page,
 * starts a temporary localhost HTTP server to receive the callback with
 * the API key, and returns the key on success.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import { spawnSync } from "child_process";

const DEFAULT_DASHBOARD_URL = "https://app.davoxi.com";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface BrowserLoginOptions {
  dashboardUrl?: string;
}

/**
 * Validate that a URL is safe to hand to the OS-level browser opener.
 * Only allow https URLs, or http://localhost / http://127.0.0.1 for local dev.
 * Exported for unit-testing purposes.
 */
export function isSafeBrowserUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]")
  ) {
    return true;
  }
  return false;
}

/**
 * Open a URL in the user's default browser.
 * Uses spawnSync without a shell so URL contents cannot be interpreted as
 * shell metacharacters. Returns false if the URL fails the safety check or
 * the underlying OS opener exits non-zero.
 */
function openBrowser(url: string): boolean {
  if (!isSafeBrowserUrl(url)) return false;

  let cmd: string;
  let args: string[];
  switch (process.platform) {
    case "darwin":
      cmd = "open";
      args = [url];
      break;
    case "win32":
      // rundll32 is built-in and accepts the URL as a parameter without shell parsing.
      cmd = "rundll32";
      args = ["url.dll,FileProtocolHandler", url];
      break;
    default:
      cmd = "xdg-open";
      args = [url];
      break;
  }

  try {
    const result = spawnSync(cmd, args, { stdio: "ignore", shell: false });
    return result.status === 0;
  } catch {
    return false;
  }
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Davoxi MCP - Authorized</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
    .card { text-align: center; padding: 3rem 2rem; background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 420px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #64748b; font-size: 0.9rem; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Authorization Successful</h1>
    <p>You can close this tab and return to your terminal.</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`;
}

/**
 * Escape a string for safe HTML interpolation.
 * Prevents XSS when error messages include user-controlled or server-controlled text.
 * Exported for unit-testing purposes.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorHtml(message: string): string {
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Davoxi MCP - Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
    .card { text-align: center; padding: 3rem 2rem; background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 420px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; color: #ef4444; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #64748b; font-size: 0.9rem; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10007;</div>
    <h1>Authorization Failed</h1>
    <p>${safeMessage}</p>
  </div>
</body>
</html>`;
}

function respond(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

/**
 * Runs the browser-based login flow:
 * 1. Start localhost callback server on a random port
 * 2. Open browser to the dashboard authorization page
 * 3. Wait for callback with API key
 * 4. Return the API key
 */
export function browserLogin(
  options?: BrowserLoginOptions,
): Promise<string> {
  const dashboardUrl = options?.dashboardUrl ?? DEFAULT_DASHBOARD_URL;
  if (!isSafeBrowserUrl(dashboardUrl)) {
    return Promise.reject(
      new Error(
        "dashboardUrl must be an https:// URL or http://localhost — refusing to open browser.",
      ),
    );
  }
  const state = randomBytes(32).toString("hex");

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        if (settled) {
          respond(res, 404, errorHtml("This page has expired."));
          return;
        }

        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

        if (url.pathname !== "/callback") {
          respond(res, 404, errorHtml("Not found."));
          return;
        }

        const returnedState = url.searchParams.get("state");
        const key = url.searchParams.get("key");
        const error = url.searchParams.get("error");

        // User cancelled
        if (error === "cancelled") {
          settled = true;
          respond(res, 200, errorHtml("Authorization was cancelled."));
          cleanup();
          reject(new Error("Authorization cancelled by user."));
          return;
        }

        // State mismatch (CSRF)
        if (returnedState !== state) {
          respond(
            res,
            400,
            errorHtml("Security check failed (state mismatch). Please try again."),
          );
          return;
        }

        // Missing or invalid key
        if (!key || !key.startsWith("sk_")) {
          respond(res, 400, errorHtml("Invalid API key received. Please try again."));
          return;
        }

        // Success
        settled = true;
        respond(res, 200, successHtml());
        cleanup();
        resolve(key);
      },
    );

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(
          new Error(
            "Login timed out after 5 minutes. Run 'npx @davoxi/mcp-server auth login' to try again.",
          ),
        );
      }
    }, LOGIN_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeout);
      server.close();
    }

    // Bind to 127.0.0.1 only (not 0.0.0.0)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        settled = true;
        cleanup();
        reject(new Error("Failed to start callback server."));
        return;
      }

      const port = addr.port;
      const authUrl = `${dashboardUrl}/mcp/authorize?port=${port}&state=${state}`;

      process.stderr.write("\n  Davoxi MCP — Browser Login\n\n");

      const opened = openBrowser(authUrl);
      if (opened) {
        process.stderr.write("  Opening browser for authorization...\n");
      } else {
        process.stderr.write("  Could not open browser automatically.\n");
      }

      process.stderr.write(`\n  Open this URL in your browser if it didn't open:\n`);
      process.stderr.write(`  ${authUrl}\n\n`);
      process.stderr.write("  Waiting for authorization...\n\n");
    });

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Callback server error: ${err.message}`));
      }
    });
  });
}
