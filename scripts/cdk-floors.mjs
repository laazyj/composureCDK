#!/usr/bin/env node

/**
 * Per-package aws-cdk-lib floor tooling. `cdk-floors.json` is the curated
 * source of truth (package -> { floor, gatedBy }); this script reads it and
 * keeps each package's `peerDependencies.aws-cdk-lib` in sync.
 *
 * - `apply` writes each package's `peerDependencies.aws-cdk-lib` from the
 *   manifest. Run it after editing `cdk-floors.json`.
 * - `check` asserts every package.json matches the manifest, exiting non-zero
 *   on drift. Cheap; wired into the main CI job and `npm run verify`.
 *
 * The discovery side (how floor values are arrived at) and the enforcement
 * side (running each package against a real install of its declared floor)
 * are separate follow-up tools — see ADR-0008.
 *
 * Usage: node scripts/cdk-floors.mjs <apply|check>
 */

import { readFileSync, writeFileSync } from "node:fs";
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

const mode = process.argv[2];
const modes = { apply, check };
if (modes[mode] !== undefined) {
  modes[mode]();
} else {
  console.error(`Unknown mode "${mode ?? ""}". Usage: node scripts/cdk-floors.mjs <apply|check>`);
  process.exit(1);
}
