import { describe, it, expect, vi, afterEach } from "vitest";
import http from "http";
import { escapeHtml } from "../auth/browser-login.js";

const { mockSpawnSync } = vi.hoisted(() => {
  const mockSpawnSync = vi.fn().mockReturnValue({ status: 0 });
  return { mockSpawnSync };
});
vi.mock("child_process", () => ({ spawnSync: mockSpawnSync }));

// ---------------------------------------------------------------------------
// escapeHtml — XSS prevention
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("returns plain text unchanged", () => {
    expect(escapeHtml("Authorization cancelled.")).toBe("Authorization cancelled.");
  });

  it("escapes < and > characters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes & character", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("escapes double-quote character", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single-quote character", () => {
    expect(escapeHtml("it's here")).toBe("it&#39;s here");
  });

  it("escapes a realistic XSS payload from err.message", () => {
    const payload = `"><img src=x onerror="alert('xss')">`;
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    expect(escaped).not.toContain('"');
  });
});

async function startAndGetEndpoint(): Promise<{
  port: number;
  state: string;
  loginPromise: Promise<string>;
}> {
  let capturedPort: number | undefined;
  let capturedState: string | undefined;

  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((msg: string | Uint8Array): boolean => {
      if (typeof msg === "string") {
        const m = msg.match(/port=(\d+)&state=([a-f0-9]+)/);
        if (m) {
          capturedPort = parseInt(m[1], 10);
          capturedState = m[2];
        }
      }
      return true;
    });

  const { browserLogin } = await import("../auth/browser-login.js");
  const loginPromise = browserLogin({ dashboardUrl: "http://127.0.0.1" });

  // Wait up to 500 ms for server to start and write port to stderr
  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const poll = setInterval(() => {
      if (capturedPort !== undefined && capturedState !== undefined) {
        clearInterval(poll);
        stderrSpy.mockRestore();
        resolve();
      } else if (Date.now() - start > 500) {
        clearInterval(poll);
        stderrSpy.mockRestore();
        reject(new Error("Timed out waiting for browser-login server to start"));
      }
    }, 5);
  });

  return { port: capturedPort!, state: capturedState!, loginPromise };
}

function callbackRequest(
  port: number,
  params: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const req = http.request(
      { hostname: "127.0.0.1", port, path: `/callback?${qs}`, method: "GET" },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("openBrowser — command injection safety", () => {
  it("passes URL as a discrete argument (not via shell string) so metacharacters cannot escape", async () => {
    // A URL containing double-quotes and semicolons would execute shell commands
    // if interpolated into execSync(`open "${url}"`). With spawnSync([url]) they
    // are passed literally to the child process and never interpreted by a shell.
    const { browserLogin } = await import("../auth/browser-login.js");
    const maliciousBase = 'http://127.0.0.1"; echo injected #';
    const loginPromise = browserLogin({ dashboardUrl: maliciousBase });

    // The mock records the args array passed to spawnSync
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockSpawnSync).toHaveBeenCalled();
    const [_cmd, args] = mockSpawnSync.mock.calls[0];
    // The full authUrl (containing the malicious base) must appear as a single
    // element in the args array — not concatenated into a shell string.
    const urlArg: string = args[args.length - 1];
    expect(typeof urlArg).toBe("string");
    expect(urlArg).toContain("echo injected");
    // No shell was invoked, so "echo injected" was NOT executed — it's just a
    // literal character sequence in the URL argument.
    loginPromise.catch(() => {});
  });
});

describe("browserLogin — API key prefix validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with the key when prefix is sk_", async () => {
    const { port, state, loginPromise } = await startAndGetEndpoint();
    const status = await callbackRequest(port, {
      state,
      key: "sk_live_abc123",
    });
    expect(status).toBe(200);
    await expect(loginPromise).resolves.toBe("sk_live_abc123");
  });

  it("rejects keys with bare sk prefix (no underscore)", async () => {
    const { port, state, loginPromise } = await startAndGetEndpoint();
    const status = await callbackRequest(port, {
      state,
      key: "skabcdef12345",
    });
    expect(status).toBe(400);
    // Server did not settle; cancel via error event (server still running)
    loginPromise.catch(() => {});
  });

  it("rejects keys with no sk prefix at all", async () => {
    const { port, state, loginPromise } = await startAndGetEndpoint();
    const status = await callbackRequest(port, {
      state,
      key: "pk_totally_wrong",
    });
    expect(status).toBe(400);
    loginPromise.catch(() => {});
  });

  it("rejects missing key parameter", async () => {
    const { port, state, loginPromise } = await startAndGetEndpoint();
    const status = await callbackRequest(port, { state });
    expect(status).toBe(400);
    loginPromise.catch(() => {});
  });
});
