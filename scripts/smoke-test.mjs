#!/usr/bin/env node

/**
 * Post-deploy smoke test runner for ComposureCDK example stacks.
 *
 * Auto-discovers SmokeCheck modules in packages/examples/test/smoke/ — each
 * module default-exports `{ name, run(ctx) }`. The runner verifies that all
 * ComposureCDK-* stacks reached a healthy status, then runs each check in
 * the order their files appear (alphabetical, with stack-health.smoke.mjs
 * forced first).
 *
 * Uses the AWS CLI (preinstalled on GitHub runners) to avoid adding SDK
 * dependencies to the project.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SMOKE_DIR = resolve(SCRIPT_DIR, "../packages/examples/test/smoke");

function aws(...args) {
  return JSON.parse(execFileSync("aws", args, { encoding: "utf8" }));
}

function getRegion() {
  if (process.env.AWS_REGION) return process.env.AWS_REGION;
  if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;
  return execFileSync("aws", ["configure", "get", "region"], { encoding: "utf8" }).trim();
}

async function loadChecks() {
  // Plain alphabetical order; numeric prefixes (e.g. 00-stack-health) hoist
  // gating checks ahead of the rest.
  const files = readdirSync(SMOKE_DIR)
    .filter((f) => f.endsWith(".smoke.mjs"))
    .sort();
  const checks = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(resolve(SMOKE_DIR, file)).href);
    if (!mod.default?.run) {
      throw new Error(`${file} — missing default export with run()`);
    }
    checks.push({ file, ...mod.default });
  }
  return checks;
}

async function main() {
  let failures = 0;
  const ctx = {
    aws,
    region: getRegion(),
    pass: (msg) => console.log(`  ✓ ${msg}`),
    fail: (msg) => {
      console.error(`  ✗ ${msg}`);
      failures++;
    },
  };

  const checks = await loadChecks();
  for (const check of checks) {
    console.log(`\n=== ${check.name} ===\n`);
    try {
      await check.run(ctx);
    } catch (err) {
      ctx.fail(`${check.name} — ${err.message}`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  } else {
    console.log("All checks passed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
