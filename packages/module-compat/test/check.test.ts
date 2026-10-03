import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runChecks } from "../checks.mjs";

describe("runChecks against the workspace build", () => {
  it("passes every package and fixture check", async () => {
    const results = await runChecks();
    expect(results.filter(({ error }) => error !== undefined)).toEqual([]);
    expect(results.length).toBeGreaterThan(3);
  }, 300_000);
});

/**
 * CI trusts these checks to turn a child's non-zero exit into a failure. If one
 * were ever swallowed, every consumer check would report green while proving
 * nothing, so assert the failure path directly.
 */
describe("runChecks failure path", () => {
  it("reports the child's stderr", async () => {
    const [result] = await runChecks({ fixtures: ["failing/exit-nonzero.js"] });
    expect(result.error).toMatch(/fixture failed on purpose/);
  });

  it("falls back to the exec error when the child fails silently", async () => {
    const [result] = await runChecks({ fixtures: ["failing/silent.js"] });
    expect(result.error).toMatch(/Command failed/);
  });

  it("runs fixtures from a copy inside another install root", async () => {
    const root = mkdtempSync(join(tmpdir(), "module-compat-root-"));
    try {
      const [result] = await runChecks({ root, fixtures: ["failing/exit-nonzero.js"] });
      expect(result.error).toMatch(/fixture failed on purpose/);
      expect(existsSync(join(root, "test/fixtures/failing/exit-nonzero.js"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check.mjs", () => {
  it("exits non-zero when a check fails", () => {
    const cli = fileURLToPath(new URL("../check.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "--fixture", "failing/exit-nonzero.js"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/fixture failed on purpose/);
  });
});
