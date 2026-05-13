import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBaseUrl } from "../tools/tools.js";

describe("resolveBaseUrl (tool-registry helpers)", () => {
  const ORIGINAL = process.env.DAVOXI_API_URL;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.DAVOXI_API_URL;
    } else {
      process.env.DAVOXI_API_URL = ORIGINAL;
    }
  });

  it("defaults to https://api.davoxi.com when DAVOXI_API_URL is unset", () => {
    delete process.env.DAVOXI_API_URL;
    expect(resolveBaseUrl()).toBe("https://api.davoxi.com");
  });

  it("accepts a custom https URL", () => {
    process.env.DAVOXI_API_URL = "https://api-staging.davoxi.com";
    expect(resolveBaseUrl()).toBe("https://api-staging.davoxi.com");
  });

  it("accepts http://localhost for local development", () => {
    process.env.DAVOXI_API_URL = "http://localhost:3000";
    expect(resolveBaseUrl()).toBe("http://localhost:3000");
  });

  it("strips trailing slashes", () => {
    process.env.DAVOXI_API_URL = "https://api.davoxi.com//";
    expect(resolveBaseUrl()).toBe("https://api.davoxi.com");
  });

  it("rejects plain-http remote URLs (would leak bearer token)", () => {
    process.env.DAVOXI_API_URL = "http://attacker.com";
    expect(() => resolveBaseUrl()).toThrow(/must be an https/);
  });

  it("rejects non-http(s) schemes", () => {
    process.env.DAVOXI_API_URL = "file:///etc/passwd";
    expect(() => resolveBaseUrl()).toThrow(/must be an https/);
  });

  it("rejects malformed URLs", () => {
    process.env.DAVOXI_API_URL = "not-a-url";
    expect(() => resolveBaseUrl()).toThrow(/is not a valid URL/);
  });

  it("rejects ftp://", () => {
    process.env.DAVOXI_API_URL = "ftp://api.davoxi.com";
    expect(() => resolveBaseUrl()).toThrow(/must be an https/);
  });
});
