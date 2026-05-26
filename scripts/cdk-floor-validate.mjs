#!/usr/bin/env node

/**
 * `cdk-floor-validate` — on-demand diagnostic that synthesises a representative
 * composed system against a real install of any chosen aws-cdk-lib version.
 *
 * Three use cases:
 *
 * 1. **Bug repro / triage.** A consumer reports a synth failure on
 *    aws-cdk-lib X.Y.Z; re-run this with `--cdk-version=X.Y.Z` and observe.
 * 2. **Candidate-floor validation.** Before lowering a package's floor in
 *    `cdk-floors.json`, run this against the candidate floor to confirm the
 *    composed system still synthesises end-to-end (`cdk-floors:enforce`
 *    proves *imports* per package; this proves the *synth path*).
 * 3. **Release prep.** Spot-check the integrated `compose(...).build()` story
 *    on the floor before announcing support.
 *
 * It is intentionally **not** a PR gate — no single fixed aws-cdk-lib version
 * is the right one to test against on every commit. The always-on gates are
 * `cdk-floors:check` (manifest <-> package.json) and `cdk-floors:enforce`
 * (per-package real-install import probe). See ADR-0008.
 *
 * Run `npm run build` first (this packs from each package's dist).
 *
 * Usage:
 *   node scripts/cdk-floor-validate.mjs                       # default: max(declared floors)
 *   node scripts/cdk-floor-validate.mjs --cdk-version=2.46.0
 *   CDK_FLOOR=2.46.0 node scripts/cdk-floor-validate.mjs
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packPublishablePackages } from "./cdk-floor/packages.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const MANIFEST = join(REPO_ROOT, "cdk-floors.json");
const CONSTRUCTS_RANGE = "^10.0.0";

/** SemVer compare (assumes plain `MAJOR.MINOR.PATCH`, no pre-release tags). */
function compareSemver(a, b) {
  const [a0, a1, a2] = a.split(".").map(Number);
  const [b0, b1, b2] = b.split(".").map(Number);
  return a0 - b0 || a1 - b1 || a2 - b2;
}

/**
 * Picks the version under test. Precedence: `--cdk-version=…` arg > CDK_FLOOR
 * env > `max(declared floors)` from the manifest. The manifest-derived default
 * means the composed-system floor is "the highest version any package
 * promises", i.e. the de-facto floor for an integrated app.
 */
function resolveVersion() {
  const flag = process.argv.find((arg) => arg.startsWith("--cdk-version="));
  if (flag !== undefined) return flag.slice("--cdk-version=".length);
  if (process.env.CDK_FLOOR !== undefined && process.env.CDK_FLOOR !== "") {
    return process.env.CDK_FLOOR;
  }
  const floors = JSON.parse(readFileSync(MANIFEST, "utf8")).floors;
  return Object.values(floors)
    .map((entry) => entry.floor)
    .sort(compareSemver)
    .at(-1);
}

const version = resolveVersion();
const rig = mkdtempSync(join(tmpdir(), `composurecdk-validate-${version.replace(/\./g, "-")}-`));
try {
  const dependencies = { "aws-cdk-lib": version, constructs: CONSTRUCTS_RANGE };
  const tarballs = packPublishablePackages(rig);
  for (const [name, tarball] of Object.entries(tarballs)) {
    dependencies[name] = `file:./${tarball}`;
  }

  writeFileSync(
    join(rig, "package.json"),
    `${JSON.stringify(
      { name: "cdk-floor-validate-rig", private: true, type: "module", dependencies },
      null,
      2,
    )}\n`,
  );
  copyFileSync(join(SCRIPT_DIR, "cdk-floor", "synth.mjs"), join(rig, "synth.mjs"));

  console.log(
    `Installing aws-cdk-lib@${version} + ${Object.keys(tarballs).length} packed packages …`,
  );
  // --legacy-peer-deps so versions below some package's declared floor still
  // install — this is a *diagnostic* probe at an arbitrary version, not an
  // assertion of the peer ranges.
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
    cwd: rig,
    stdio: "inherit",
  });

  console.log(`Synthesising the composed system against aws-cdk-lib@${version} …`);
  execFileSync(process.execPath, ["synth.mjs"], { cwd: rig, stdio: "inherit" });

  console.log(`\n✓ cdk-floor-validate passed on aws-cdk-lib ${version}`);
} catch (error) {
  console.error(`\n✗ cdk-floor-validate failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(rig, { recursive: true, force: true });
}
