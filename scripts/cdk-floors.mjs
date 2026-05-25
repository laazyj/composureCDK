#!/usr/bin/env node

/**
 * Per-package aws-cdk-lib floor tooling.
 *
 * `establish` sweeps a descending ladder of real aws-cdk-lib versions and, for
 * each publishable @composurecdk package, records the lowest version it still
 * loads on plus the API that gates it (the named export missing one rung
 * lower). It writes that to cdk-floors.json — the source of truth from which
 * per-package `peerDependencies` are set and enforced.
 *
 * This measures the import-time floor (named exports a package pulls from
 * aws-cdk-lib), which is where every floor constraint we have hit lives. The
 * runtime-complete guard is `enforce` (runs each package's suite at its
 * declared floor); a runtime-only gap there raises the floor above what
 * `establish` found.
 *
 * Usage: node scripts/cdk-floors.mjs establish
 * Run `npm run build` first (it packs from each package's dist).
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
    execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
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
      MANIFEST,
      `${JSON.stringify(
        {
          $comment:
            "Per-package aws-cdk-lib import-time floors, from `node scripts/cdk-floors.mjs establish`. " +
            "Ladder-granular; floor is the lowest probed release that loads, gatedBy is the API missing one rung lower.",
          ladder: LADDER,
          floors,
        },
        null,
        2,
      )}\n`,
    );

    console.log(`\nWrote ${MANIFEST}\n`);
    for (const [pkg, { floor, gatedBy }] of Object.entries(floors)) {
      console.log(`  ${pkg.padEnd(16)} >= ${floor.padEnd(10)} ${gatedBy ?? ""}`);
    }
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
if (mode === "establish") {
  establish();
} else {
  console.error(`Unknown mode "${mode ?? ""}". Usage: node scripts/cdk-floors.mjs establish`);
  process.exit(1);
}
