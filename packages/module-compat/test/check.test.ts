import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CHECK = fileURLToPath(new URL("../check.mjs", import.meta.url));

function check(...args: string[]) {
  return spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });
}

describe("check.mjs against the workspace build", () => {
  it("passes every package and fixture check", () => {
    const result = check();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 300_000);
});

/**
 * CI trusts check.mjs to turn a child's non-zero exit into a failed run. If it
 * ever swallowed one, every consumer check would report green while proving
 * nothing, so assert the failure path directly.
 */
describe("check.mjs failure path", () => {
  it("fails the run, quoting the child's stderr", () => {
    const result = check("--fixture", "failing/exit-nonzero.js");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/fixture failed on purpose/);
  });

  it("falls back to the exec error when the child fails silently", () => {
    const result = check("--fixture", "failing/silent.js");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Command failed/);
  });
});
