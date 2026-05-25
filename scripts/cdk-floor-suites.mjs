#!/usr/bin/env node

/**
 * aws-cdk-lib floor compatibility harness (exhaustive-suites half).
 *
 * Pins a real aws-cdk-lib floor across the workspace and runs every package's
 * own unit suite against it, so a too-new CDK API in *any* package surfaces —
 * not just the composed smoke that `cdk-floor-test.mjs` exercises.
 *
 * This is a floor-*finding* tool, run manually (the `cdk-floor-suites` workflow,
 * dispatched with a version). It is NOT a PR gate: the per-package suites use
 * partial matchers and mostly hold across versions, but exact-output assertions
 * drift, so a failure means "investigate", not necessarily "broken". The
 * always-on PR gate is the drift-robust composed synth in `cdk-floor-test.mjs`.
 *
 * MUTATES the workspace (installs the floor over node_modules; the example
 * suites rewrite their snapshots). Intended for ephemeral CI — run `npm ci`
 * (and `git checkout packages/examples/test/__snapshots__`) to restore locally.
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLOOR = process.env.CDK_FLOOR ?? "2.230.0";

if (process.env.CI === undefined && !process.argv.includes("--force")) {
  console.error(
    "cdk-floor-suites mutates node_modules and rewrites example snapshots — it is meant for CI.\n" +
      "Run with --force to proceed locally, then restore with `npm ci` and " +
      "`git checkout packages/examples/test/__snapshots__`.",
  );
  process.exit(1);
}

function run(cmd, args, extraEnv) {
  execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
}

console.log(`Pinning aws-cdk-lib@${FLOOR} across the workspace …`);
run("npm", ["install", "--no-save", "--no-audit", "--no-fund", `aws-cdk-lib@${FLOOR}`]);

// Builder/core suites use partial matchers, so they assert against the floor
// directly. Exclude examples here — they assert exact CFN snapshots that drift
// across versions — and run them separately in synth-only (snapshot-rewriting)
// mode below.
console.log("Running per-package unit suites against the floor …");
run(
  "npx",
  ["nx", "run-many", "-t", "test", "--exclude", "@composurecdk/examples", "--skip-nx-cache"],
  {
    NX_DAEMON: "false",
  },
);

// `--update` makes the example suites regenerate their snapshots, so they
// exercise a full synth of every example stack (the broadest integration
// surface) without failing on benign cross-version output drift.
console.log("Synthesising every example stack against the floor …");
run("npm", ["run", "--workspace", "@composurecdk/examples", "test:update"]);

console.log(`\n✓ cdk-floor-suites passed on aws-cdk-lib ${FLOOR}`);
