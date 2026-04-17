import { describe, it, expect, vi, afterEach } from "vitest";
import http from "http";

vi.mock("child_process", () => ({ execSync: vi.fn() }));

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
