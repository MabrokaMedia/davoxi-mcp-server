import { describe, it, expect, vi } from "vitest";
import { isSafeBrowserUrl, browserLogin } from "../auth/browser-login.js";

vi.mock("child_process", () => ({ spawnSync: vi.fn(() => ({ status: 0 })) }));

describe("isSafeBrowserUrl", () => {
  it("accepts https URLs", () => {
    expect(isSafeBrowserUrl("https://app.davoxi.com")).toBe(true);
    expect(isSafeBrowserUrl("https://app.davoxi.com/mcp/authorize?x=1")).toBe(true);
  });

  it("accepts http://localhost and http://127.0.0.1", () => {
    expect(isSafeBrowserUrl("http://localhost:3000")).toBe(true);
    expect(isSafeBrowserUrl("http://127.0.0.1")).toBe(true);
    expect(isSafeBrowserUrl("http://[::1]")).toBe(true);
  });

  it("rejects http URLs that aren't localhost", () => {
    expect(isSafeBrowserUrl("http://example.com")).toBe(false);
    expect(isSafeBrowserUrl("http://1.2.3.4")).toBe(false);
    expect(isSafeBrowserUrl("http://attacker.example/")).toBe(false);
  });

  it("rejects file:// URLs", () => {
    expect(isSafeBrowserUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeBrowserUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isSafeBrowserUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects garbage / non-URLs", () => {
    expect(isSafeBrowserUrl("not a url")).toBe(false);
    expect(isSafeBrowserUrl("")).toBe(false);
    expect(isSafeBrowserUrl(`https://x" && rm -rf /`)).toBe(false);
  });

  it("treats URLs with embedded shell metacharacters as not http(s) and rejects them", () => {
    // Even if URL parser succeeds with weird input, only https:/http:localhost are accepted.
    expect(isSafeBrowserUrl("ssh://1.2.3.4")).toBe(false);
    expect(isSafeBrowserUrl("ftp://1.2.3.4")).toBe(false);
  });
});

describe("browserLogin — rejects unsafe dashboardUrl", () => {
  it("rejects when dashboardUrl is http://attacker.example", async () => {
    await expect(
      browserLogin({ dashboardUrl: "http://attacker.example" }),
    ).rejects.toThrow(/dashboardUrl must be/);
  });

  it("rejects when dashboardUrl is file://", async () => {
    await expect(
      browserLogin({ dashboardUrl: "file:///etc/passwd" }),
    ).rejects.toThrow(/dashboardUrl must be/);
  });

  it("rejects when dashboardUrl is malformed", async () => {
    await expect(
      browserLogin({ dashboardUrl: "not-a-url-at-all" }),
    ).rejects.toThrow(/dashboardUrl must be/);
  });
});
