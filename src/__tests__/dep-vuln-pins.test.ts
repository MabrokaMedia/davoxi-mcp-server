import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Security regression test: pins transitive dependency versions known
 * to have had high-severity advisories patched in a specific release.
 *
 * If npm later resolves an older (vulnerable) version into the lockfile,
 * these tests fail. Add a new entry every time a future audit-fix patches
 * a transitive.
 */

interface LockEntry {
  version?: string;
}
interface Lockfile {
  packages?: Record<string, LockEntry>;
}

function readLockfile(): Lockfile {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const lockPath = path.join(__dirname, "..", "..", "package-lock.json");
  return JSON.parse(readFileSync(lockPath, "utf8")) as Lockfile;
}

function findPackageVersions(lock: Lockfile, name: string): string[] {
  const pkgs = lock.packages || {};
  const versions: string[] = [];
  for (const [key, val] of Object.entries(pkgs)) {
    if (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)) {
      if (val && typeof val.version === "string") versions.push(val.version);
    }
  }
  return versions;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

describe("transitive dependency security pins", () => {
  let lock: Lockfile;
  beforeAll(() => {
    lock = readLockfile();
  });

  // GHSA-q3j6-qgpj-74h6 + GHSA-v39h-62p7-jpjc — fixed in 3.1.2+
  it("fast-uri is at or above the patched 3.1.2 threshold", () => {
    const versions = findPackageVersions(lock, "fast-uri");
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(compareSemver(v, "3.1.2")).toBeGreaterThanOrEqual(0);
    }
  });
});
