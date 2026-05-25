#!/usr/bin/env node

/**
 * Per-package aws-cdk-lib floor tooling. cdk-floors.json is the curated source
 * of truth (package -> { floor, gatedBy }); four modes feed, apply and guard it:
 *
 * - `establish` sweeps a descending ladder of real aws-cdk-lib versions and,
 *   for each publishable @composurecdk package, records the lowest version it
 *   still loads on plus the API that gates it (the named export missing one
 *   rung lower). It writes a ladder-granular draft to cdk-floors.discovered.json
 *   to be refined into cdk-floors.json — re-running it never clobbers curation.
 * - `apply` writes each package's peerDependencies.aws-cdk-lib from the manifest.
 * - `check` asserts package.json ranges match the manifest (a cheap CI gate).
 * - `enforce` loads each package at its own declared floor and fails if any
 *   doesn't — the "don't breach the floor" guard.
 *
 * `establish`/`enforce` measure the import-time floor (named exports a package
 * pulls from aws-cdk-lib), which is where every floor constraint we have hit
 * lives. A runtime-only gap would surface in a package's suite run at its floor.
 *
 * Usage: node scripts/cdk-floors.mjs <establish|apply|check|enforce>
 * `establish`/`enforce` need `npm run build` first (they pack from each dist).
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
// `establish` writes its raw discovery here; cdk-floors.json is the curated,
// refined source of truth that `apply`/`check` consume — so re-running
// `establish` never clobbers hand-refined floors.
const DISCOVERED = join(REPO_ROOT, "cdk-floors.discovered.json");
const CONSTRUCTS_RANGE = "^10.0.0";

// Descending ladder of real aws-cdk-lib releases to probe. Floors land on a
// rung; refine by adding rungs around a boundary. Override with
// CDK_FLOOR_LADDER="2.230.0,2.200.0,…".
const LADDER = (
  process.env.CDK_FLOOR_LADDER ??
  "2.230.0,2.200.0,2.180.0,2.160.0,2.140.0,2.131.0,2.120.0,2.100.0,2.80.0,2.60.0,2.46.0,2.20.0,2.1.0"
).split(",");

const minorOf = (version) => Number(version.split(".")[1]);

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
  const rig = mkdtempSync(join(tmpdir(), `composurecdk-floor-${minorOf(version)}-`));
  try {
    const dependencies = { "aws-cdk-lib": version, constructs: CONSTRUCTS_RANGE };
    for (const [name, tarball] of Object.entries(tarballs)) {
      dependencies[name] = `file:${join(cacheDir, tarball)}`;
    }
    writeFileSync(
      join(rig, "package.json"),
      `${JSON.stringify({ name: "cdk-floor-probe", private: true, type: "module", dependencies }, null, 2)}\n`,
    );
    copyFileSync(join(SCRIPT_DIR, "cdk-floor", "probe.mjs"), join(rig, "probe.mjs"));
    // --legacy-peer-deps: we deliberately install at versions that violate the
    // packages' own declared peer floors — the point is to test whether the
    // imports resolve at `version`, not whether the declared ranges agree.
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

function establish() {
  const cacheDir = mkdtempSync(join(tmpdir(), "composurecdk-floor-tarballs-"));
  try {
    console.log("Packing publishable packages …");
    const tarballs = packAll(cacheDir);
    const names = Object.keys(tarballs);

    // results[name] = ordered (high→low) list of { version, ok, error }
    const results = Object.fromEntries(names.map((n) => [n, []]));
    for (const version of LADDER) {
      process.stdout.write(`Probing aws-cdk-lib@${version} … `);
      const probed = probeAtVersion(version, tarballs, cacheDir);
      for (const { name, ok, error } of probed) results[name].push({ version, ok, error });
      console.log(`${probed.filter((r) => r.ok).length}/${names.length} packages load`);
    }

    const floors = {};
    for (const name of names) {
      const rungs = results[name]; // high → low
      let floor;
      let gatedBy;
      for (let i = 0; i < rungs.length; i++) {
        if (rungs[i].ok) {
          floor = rungs[i].version;
          gatedBy = rungs[i + 1]?.error; // why the next rung down fails
        } else break;
      }
      floors[name.replace("@composurecdk/", "")] =
        floor === undefined
          ? { floor: `>${LADDER[0]}`, gatedBy: rungs[0]?.error }
          : { floor, gatedBy: gatedBy ?? `<=${LADDER[LADDER.length - 1]} (no lower rung probed)` };
    }

    writeFileSync(
      DISCOVERED,
      `${JSON.stringify(
        {
          $comment:
            "Raw discovery from `node scripts/cdk-floors.mjs establish` — ladder-granular. " +
            "Refine the floors to the exact introducing release and copy into cdk-floors.json (the curated source of truth).",
          ladder: LADDER,
          floors,
        },
        null,
        2,
      )}\n`,
    );

    console.log(`\nWrote ${DISCOVERED} (draft — refine into cdk-floors.json)\n`);
    for (const [pkg, { floor, gatedBy }] of Object.entries(floors)) {
      console.log(`  ${pkg.padEnd(16)} >= ${floor.padEnd(10)} ${gatedBy ?? ""}`);
    }
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

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

/**
 * Loads each package against a real install of its *own* declared floor and
 * fails if any doesn't — the "don't breach the floor" guard. Catches a change
 * that reaches for an aws-cdk-lib API newer than the package promises.
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
const modes = { establish, apply, check, enforce };
if (modes[mode] !== undefined) {
  modes[mode]();
} else {
  console.error(
    `Unknown mode "${mode ?? ""}". Usage: node scripts/cdk-floors.mjs <establish|apply|check|enforce>`,
  );
  process.exit(1);
}
