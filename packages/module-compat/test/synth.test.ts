import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

const FIXTURES = [
  { syntax: "CommonJS require()", entry: join(fixturesDir, "cjs", "synth.js") },
  { syntax: "ESM import", entry: join(fixturesDir, "esm", "synth.js") },
] as const;

/**
 * Each fixture is a tiny CDK app that loads `@composurecdk/*` packages and runs
 * `compose(...).build(app, id)` + `app.synth()` — the real `cdk synth` path
 * from issue #119. Spawning a fresh `node` per fixture exercises actual module
 * resolution (the `require`/`import` export conditions) and the `Ref` brand
 * across the dual-package boundary. `cdk.out` is written to a throwaway temp
 * dir so the test leaves no trace.
 */
describe.each(FIXTURES)("cdk synth via $syntax", ({ entry }) => {
  it("synthesizes a ref-wired composed system", () => {
    const outDir = mkdtempSync(join(tmpdir(), "composurecdk-module-compat-"));
    try {
      execFileSync(process.execPath, [entry], {
        cwd: outDir,
        stdio: ["ignore", "ignore", "pipe"],
        // Generous: a cold `node` loading aws-cdk-lib plus a full synth.
        timeout: 60_000,
      });
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
      throw new Error(`cdk synth fixture "${entry}" failed:\n${stderr ?? String(error)}`, {
        cause: error,
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
