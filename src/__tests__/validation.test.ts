import { describe, it, expect } from "vitest";
import { validateApiUrl } from "../index.js";

describe("validateApiUrl", () => {
  it("accepts a valid https:// URL", () => {
    const url = "https://api.davoxi.com";
    expect(validateApiUrl(url)).toBe(url);
  });

  it("accepts https:// URL with path", () => {
    const url = "https://api.davoxi.com/v1";
    expect(validateApiUrl(url)).toBe(url);
  });

  it("accepts http://localhost for local development", () => {
    const url = "http://localhost:3000";
    expect(validateApiUrl(url)).toBe(url);
  });

  it("accepts http://127.0.0.1 for local development", () => {
    const url = "http://127.0.0.1:8080";
    expect(validateApiUrl(url)).toBe(url);
  });

  it("rejects a plain string that is not a URL", () => {
    expect(() => validateApiUrl("not-a-url")).toThrow(
      /DAVOXI_API_URL is not a valid URL/,
    );
  });

  it("rejects http:// for non-localhost hosts", () => {
    expect(() => validateApiUrl("http://api.davoxi.com")).toThrow(
      /must be an https:\/\/ URL or http:\/\/localhost/,
    );
  });

  it("rejects ftp:// URLs", () => {
    expect(() => validateApiUrl("ftp://api.davoxi.com")).toThrow(
      /must be an https:\/\/ URL or http:\/\/localhost/,
    );
  });

  it("rejects an empty string", () => {
    expect(() => validateApiUrl("")).toThrow(/DAVOXI_API_URL is not a valid URL/);
  });
});
