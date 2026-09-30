#!/usr/bin/env node

/**
 * `zizmor` — audit the GitHub Actions workflows and Dependabot config with
 * zizmor (https://docs.zizmor.sh). docs/ci.md#auditing-the-workflows has the
 * why of each choice below.
 *
 * zizmor comes from PATH. Locally a missing zizmor skips the audit; in CI it
 * fails, so the gate cannot go hollow where it is enforced. Local runs are
 * `--offline`, keeping the GitHub API off the pre-push path; CI runs the
 * online audits too.
 *
 * Any arguments are ignored, as in scripts/actionlint.mjs: zizmor finds every
 * input itself, so `lint-staged` audits the whole set when any one is staged.
 *
 * Usage:
 *   node scripts/zizmor.mjs
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Same test as scripts/cdk-floors.mjs.
const inCi = process.env.CI !== undefined;

// spawnSync rather than execFileSync: a non-zero exit is the expected outcome
// on findings and must be forwarded, not thrown.
const run = spawnSync("zizmor", inCi ? ["."] : ["--offline", "."], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (run.error?.code === "ENOENT") {
  const log = inCi ? console.error : console.warn;
  log("zizmor: not found on PATH. Install it to audit the workflows:");
  log("  macOS          brew install zizmor");
  log("  other          https://docs.zizmor.sh/installation/");
  log(inCi ? "zizmor: refusing to skip in CI." : "Skipping the audit; CI runs it.");
  process.exit(inCi ? 1 : 0);
}

process.exit(run.status ?? 1);
