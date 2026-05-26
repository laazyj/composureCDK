#!/usr/bin/env node

/**
 * Per-package aws-cdk-lib floor tooling. `cdk-floors.json` is the curated
 * source of truth (package -> { floor, gatedBy }); this script reads it,
 * keeps each package's `peerDependencies.aws-cdk-lib` in sync, and verifies
 * that the declared floors actually hold at runtime.
 *
 * - `apply` writes each package's `peerDependencies.aws-cdk-lib` from the
 *   manifest. Run it after editing `cdk-floors.json`.
 * - `check` asserts every package.json matches the manifest, exiting non-zero
 *   on drift. Cheap; wired into the main CI job and `npm run verify`.
 * - `enforce` loads each package against a real install of its own declared
 *   floor and fails if any doesn't — the "don't breach the floor" PR gate.
 *   Heavier (network installs); runs in its own CI job. See ADR-0008.
 *
 * The discovery side (`establish`, how floor values are arrived at in the
 * first place) is a separate follow-up tool.
 *
 * Usage: node scripts/cdk-floors.mjs <apply|check|enforce>
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const MANIFEST = join(REPO_ROOT, "cdk-floors.json");
const CONSTRUCTS_RANGE = "^10.0.0";

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

function discoverPublishablePackages() {
  const names = [];
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, entry.name, "package.json"), "utf8"));
      if (pkg.name?.startsWith("@composurecdk/") && pkg.private !== true) {
        names.push({ name: pkg.name, dir: entry.name });
      }
    } catch {
      // Not a package directory — skip.
    }
  }
  return names;
}

/** `npm pack`s every publishable package into `destination`, returning name -> tarball-filename. */
function packAll(destination) {
  const tarballs = {};
  for (const { name, dir } of discoverPublishablePackages()) {
    const output = execFileSync("npm", ["pack", "--pack-destination", destination], {
      cwd: join(PACKAGES_DIR, dir),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const tarball = output
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.endsWith(".tgz"));
    if (tarball === undefined) throw new Error(`npm pack for ${dir} produced no .tgz`);
    tarballs[name] = tarball;
  }
  return tarballs;
}

/** Install the packed packages + aws-cdk-lib@version into a rig, probe each import. */
function probeAtVersion(version, tarballs, cacheDir) {
  const rig = mkdtempSync(join(tmpdir(), `composurecdk-floor-${version.replace(/\./g, "-")}-`));
  try {
    const dependencies = { "aws-cdk-lib": version, constructs: CONSTRUCTS_RANGE };
    for (const [name, tarball] of Object.entries(tarballs)) {
      dependencies[name] = `file:${join(cacheDir, tarball)}`;
    }
    writeFileSync(
      join(rig, "package.json"),
      `${JSON.stringify({ name: "cdk-floors-probe", private: true, type: "module", dependencies }, null, 2)}\n`,
    );
    copyFileSync(join(SCRIPT_DIR, "cdk-floor", "probe.mjs"), join(rig, "probe.mjs"));
    // --legacy-peer-deps: we deliberately install at versions that violate
    // some packages' declared peer floors — the point is to test whether the
    // group at *this* floor loads, not whether unrelated packages' ranges are
    // satisfied at it.
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
      cwd: rig,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const out = execFileSync(process.execPath, ["probe.mjs"], {
      cwd: rig,
      encoding: "utf8",
      env: { ...process.env, CDK_FLOOR_PACKAGES: JSON.stringify(Object.keys(tarballs)) },
    });
    return JSON.parse(out);
  } finally {
    rmSync(rig, { recursive: true, force: true });
  }
}

/**
 * Loads each package against a real install of its *own* declared floor and
 * fails if any doesn't. Groups packages by floor so we do one install per
 * distinct floor (~7 today) rather than per package.
 */
function enforce() {
  const byFloor = new Map();
  for (const [pkg, { floor }] of Object.entries(readFloors())) {
    if (!byFloor.has(floor)) byFloor.set(floor, []);
    byFloor.get(floor).push(`@composurecdk/${pkg}`);
  }
  const cacheDir = mkdtempSync(join(tmpdir(), "composurecdk-floor-tarballs-"));
  try {
    console.log("Packing publishable packages …");
    const tarballs = packAll(cacheDir);
    const failures = [];
    for (const [floor, group] of [...byFloor].sort()) {
      process.stdout.write(`Enforcing aws-cdk-lib@${floor} for ${group.length} package(s) … `);
      const loaded = probeAtVersion(floor, tarballs, cacheDir).filter((r) =>
        group.includes(r.name),
      );
      const failed = loaded.filter((r) => !r.ok);
      console.log(failed.length === 0 ? "ok" : `${failed.length} FAILED`);
      for (const r of failed) failures.push(`  ${r.name} @ ${floor}: ${r.error}`);
    }
    if (failures.length > 0) {
      console.error(
        `\ncdk-floors enforce failed — a package needs a newer aws-cdk-lib than its declared floor:\n${failures.join("\n")}\n\n` +
          "Either avoid the newer API, or raise the floor (update cdk-floors.json, run `npm run cdk-floors:apply`).",
      );
      process.exit(1);
    }
    console.log("\ncdk-floors enforce passed (every package loads at its declared floor)");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
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
