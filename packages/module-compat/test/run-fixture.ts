import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

/**
 * Runs a fixture app, named relative to `test/fixtures/`, in a fresh `node` —
 * failing the calling test with the child's stderr if it exits non-zero.
 * Spawning rather than importing is the point: only a real process exercises
 * the `require`/`import` export conditions and the module resolution they
 * drive.
 *
 * `cdk.out` (written by any fixture that calls `app.synth()`) goes to a
 * throwaway temp dir, so the test leaves no trace.
 */
export function runFixture(fixture: string): void {
  const outDir = mkdtempSync(join(tmpdir(), "composurecdk-module-compat-"));
  try {
    execFileSync(process.execPath, [join(fixturesDir, fixture)], {
      cwd: outDir,
      stdio: ["ignore", "ignore", "pipe"],
      // Generous: a cold `node` loading aws-cdk-lib plus a full synth.
      timeout: 60_000,
    });
  } catch (error) {
    // A child that fails without saying anything (or a spawn that never
    // produced a child at all) leaves nothing useful in stderr, so fall back to
    // the exec error — which at least carries the exit code or signal.
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    const detail = stderr === undefined || stderr === "" ? String(error) : stderr;
    throw new Error(`fixture "${fixture}" failed:\n${detail}`, { cause: error });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
