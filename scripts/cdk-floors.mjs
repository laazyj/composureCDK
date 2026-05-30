#!/usr/bin/env node

/**
 * Per-package aws-cdk-lib floor tooling. `cdk-floors.json` is the curated
 * source of truth (package -> { floor, gatedBy }); this script reads it,
 * keeps each package's `peerDependencies.aws-cdk-lib` in sync, and verifies
 * the declared floors actually hold by running each package's existing unit
 * suite against a real install of its own floor.
 *
 * - `apply` writes each package's `peerDependencies.aws-cdk-lib` from the
 *   manifest. Run it after editing `cdk-floors.json`.
 * - `check` asserts every package.json matches the manifest, exiting non-zero
 *   on drift. Cheap; wired into the main CI job and `npm run verify`.
 * - `enforce` pins aws-cdk-lib to a declared floor (via a temporary npm
 *   `overrides`, which forces every copy in the tree, not just the hoisted
 *   one) on a from-scratch install, asserts the floor actually bound, then
 *   runs that floor's package group's unit suite against it. Catches both
 *   import-time (missing named export) and runtime (calling a too-new method,
 *   e.g. the #146 `CfnAlarm.isCfnAlarm` inside an Aspect) version-gated APIs.
 *   CI runs it as a matrix, one floor per shard. Locally it requires `--force`
 *   and restores package.json / package-lock.json / node_modules when done
 *   (and on Ctrl-C). See ADR-0008.
 *
 * Usage:
 *   node scripts/cdk-floors.mjs apply
 *   node scripts/cdk-floors.mjs check
 *   node scripts/cdk-floors.mjs enforce              # every floor (CI: all shards)
 *   node scripts/cdk-floors.mjs enforce 2.118.0      # one floor (CI matrix shard)
 *   CDK_FLOORS_FLOOR=2.118.0 node scripts/cdk-floors.mjs enforce
 *   node scripts/cdk-floors.mjs enforce --force      # local: also restores after
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const MANIFEST = join(REPO_ROOT, "cdk-floors.json");

function pkgJsonPath(pkg) {
  return join(PACKAGES_DIR, pkg, "package.json");
}

function readFloors() {
  return JSON.parse(readFileSync(MANIFEST, "utf8")).floors;
}

/** Writes each package's peerDependencies.aws-cdk-lib from the curated manifest. */
function apply() {
  for (const [pkg, { floor }] of Object.entries(readFloors())) {
    const path = pkgJsonPath(pkg);
    const json = JSON.parse(readFileSync(path, "utf8"));
    if (json.peerDependencies?.["aws-cdk-lib"] === undefined) {
      console.log(`  ${pkg.padEnd(16)} skipped (no aws-cdk-lib peer — constructs only)`);
      continue;
    }
    json.peerDependencies["aws-cdk-lib"] = `^${floor}`;
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`  ${pkg.padEnd(16)} aws-cdk-lib ^${floor}`);
  }
  console.log("\nApplied to package.json files (run `npm run format` to normalise).");
}

/** Asserts each package.json peer range matches the manifest; non-zero on drift. */
function check() {
  const floors = readFloors();
  const mismatches = [];
  for (const [pkg, { floor }] of Object.entries(floors)) {
    const actual = JSON.parse(readFileSync(pkgJsonPath(pkg), "utf8")).peerDependencies?.[
      "aws-cdk-lib"
    ];
    if (actual !== `^${floor}`) {
      mismatches.push(
        `  ${pkg}: package.json has "${actual ?? "(unset)"}", manifest expects "^${floor}"`,
      );
    }
  }
  if (mismatches.length > 0) {
    console.error(
      `cdk-floors check failed — run \`npm run cdk-floors:apply\`:\n${mismatches.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `cdk-floors check passed (${Object.keys(floors).length} packages match the manifest)`,
  );
}

function groupByFloor(floors) {
  const byFloor = new Map();
  for (const [pkg, { floor }] of Object.entries(floors)) {
    if (!byFloor.has(floor)) byFloor.set(floor, []);
    byFloor.get(floor).push(`@composurecdk/${pkg}`);
  }
  return byFloor;
}

/** The aws-cdk-lib version `pkgName` actually resolves, from inside its own dir. */
function resolvedVersionFor(pkgName) {
  const cwd = join(PACKAGES_DIR, pkgName.replace("@composurecdk/", ""));
  return execFileSync(
    process.execPath,
    ["-e", "process.stdout.write(require('aws-cdk-lib/package.json').version)"],
    { cwd, encoding: "utf8" },
  ).trim();
}

/**
 * For each target floor: temporarily force aws-cdk-lib to that floor via npm
 * `overrides` on a from-scratch install (overrides only bind on a clean tree),
 * assert a package in the group actually resolves the floor, then run that
 * group's unit suite. With no arg, runs every floor; with a floor arg or
 * `CDK_FLOORS_FLOOR`, just that one (a CI matrix shard).
 *
 * Mutates package.json / package-lock.json / node_modules. They are restored
 * on completion and on SIGINT/SIGTERM, so a local run never leaves a stray
 * `overrides` entry or a floor-pinned install behind.
 */
function enforce() {
  const requested = process.env.CDK_FLOORS_FLOOR ?? process.argv[3];
  const hasRequested = requested !== undefined && requested !== "" && requested !== "--force";
  const byFloor = groupByFloor(readFloors());
  if (hasRequested && !byFloor.has(requested)) {
    console.error(
      `cdk-floors enforce: no packages declare aws-cdk-lib floor ${requested}.\n` +
        `  Known floors: ${[...byFloor.keys()].join(", ")}`,
    );
    process.exit(1);
  }
  const targets = hasRequested ? [[requested, byFloor.get(requested)]] : [...byFloor];

  const local = process.env.CI === undefined;
  if (local && !process.argv.includes("--force")) {
    console.error(
      "cdk-floors enforce rewrites package.json and reinstalls node_modules per floor.\n" +
        "Re-run with --force to confirm; the workspace is restored automatically afterwards.",
    );
    process.exit(1);
  }

  const PKG = join(REPO_ROOT, "package.json");
  const LOCK = join(REPO_ROOT, "package-lock.json");
  const NODE_MODULES = join(REPO_ROOT, "node_modules");
  const pkgBackup = readFileSync(PKG, "utf8");
  const lockBackup = existsSync(LOCK) ? readFileSync(LOCK, "utf8") : undefined;
  let mutated = false;

  // Restoring package.json + lock is just file writes, so it is safe to run
  // from a signal handler; the heavier `npm ci` only runs on the normal path.
  const restoreManifest = () => {
    writeFileSync(PKG, pkgBackup);
    if (lockBackup !== undefined) writeFileSync(LOCK, lockBackup);
  };
  const onSignal = () => {
    restoreManifest();
    if (mutated && local) {
      console.error(
        "\nInterrupted — restored package.json/package-lock.json. node_modules may still " +
          "be pinned to a floor; run `npm ci` to restore it.",
      );
    }
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let exitCode = 0;
  try {
    for (const [floor, group] of targets) {
      console.log(`\n=== Enforcing aws-cdk-lib@${floor} for ${group.length} package(s) ===`);
      mutated = true;

      // Derive the override from the pristine backup each time (so floors don't
      // compound) and install from scratch — overrides only bind on a clean tree.
      const manifest = JSON.parse(pkgBackup);
      manifest.overrides = { ...manifest.overrides, "aws-cdk-lib": floor };
      writeFileSync(PKG, `${JSON.stringify(manifest, null, 2)}\n`);
      // Both must go for npm to re-resolve under the override: with node_modules
      // present npm reports "up to date", and with the lockfile present it
      // installs the locked (latest) version regardless of the override.
      rmSync(NODE_MODULES, { recursive: true, force: true });
      rmSync(LOCK, { force: true });
      execFileSync("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });

      // Hard gate: confirm the floor bound for this group (not a nested latest
      // copy), so the run can never silently pass against the wrong version.
      const sample = group[0];
      const got = resolvedVersionFor(sample);
      if (got !== floor) {
        throw new Error(
          `floor pin failed: ${sample} resolves aws-cdk-lib ${got}, expected ${floor} — ` +
            "the override did not bind (stale node_modules?).",
        );
      }
      console.log(`  ${sample} resolves aws-cdk-lib ${got} ✓`);

      try {
        execFileSync(
          "npx",
          ["nx", "run-many", "-t", "test", "--projects", group.join(","), "--skip-nx-cache"],
          { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, NX_DAEMON: "false" } },
        );
        console.log(`✓ aws-cdk-lib@${floor} (${group.length} package(s)) ok`);
      } catch {
        exitCode = 1;
        console.error(`✗ aws-cdk-lib@${floor} FAILED`);
      }
    }
  } catch (error) {
    exitCode = 1;
    console.error(`\ncdk-floors enforce errored: ${error.message}`);
  } finally {
    restoreManifest();
    if (mutated && local) {
      console.log("\nRestoring workspace (npm ci) …");
      execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: REPO_ROOT, stdio: "inherit" });
      // A failed floor build leaves a `.tshy-build` dir behind, which would
      // break the next `npm run lint`; clear tshy intermediates so the
      // restored tree is clean.
      for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        rmSync(join(PACKAGES_DIR, entry.name, ".tshy"), { recursive: true, force: true });
        rmSync(join(PACKAGES_DIR, entry.name, ".tshy-build"), { recursive: true, force: true });
      }
    }
  }

  if (exitCode === 0) {
    console.log(
      "\ncdk-floors enforce passed (every package's unit suite ran against its declared floor)",
    );
  }
  process.exit(exitCode);
}

const mode = process.argv[2];
const modes = { apply, check, enforce };
if (modes[mode] !== undefined) {
  modes[mode]();
} else {
  console.error(
    `Unknown mode "${mode ?? ""}". Usage: node scripts/cdk-floors.mjs <apply|check|enforce>`,
  );
  process.exit(1);
}
