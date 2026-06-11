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
 * - `establish` is the discovery side: packs the graph and probes every package
 *   against a descending ladder of real aws-cdk-lib releases, recording the
 *   lowest each loads on and the gating export. Writes a ladder-granular
 *   draft (`cdk-floors.discovered.json`) to be refined into `cdk-floors.json`.
 *   Manual; used when establishing or deliberately lowering a floor.
 *
 * Usage:
 *   node scripts/cdk-floors.mjs apply
 *   node scripts/cdk-floors.mjs check
 *   node scripts/cdk-floors.mjs enforce              # every floor (CI: all shards)
 *   node scripts/cdk-floors.mjs enforce 2.118.0      # one floor (CI matrix shard)
 *   CDK_FLOORS_FLOOR=2.118.0 node scripts/cdk-floors.mjs enforce
 *   node scripts/cdk-floors.mjs enforce --force      # local: also restores after
 *   node scripts/cdk-floors.mjs establish            # write cdk-floors.discovered.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packPublishablePackages } from "./cdk-floor/packages.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const MANIFEST = join(REPO_ROOT, "cdk-floors.json");
// `establish` writes its raw discovery here; cdk-floors.json is the curated,
// refined source of truth that the other modes consume — so re-running
// `establish` never clobbers hand-refined floors.
const DISCOVERED = join(REPO_ROOT, "cdk-floors.discovered.json");
const CONSTRUCTS_RANGE = "^10.0.0";

// Descending ladder of real aws-cdk-lib releases that `establish` probes.
// Floors land on a rung; refine by adding rungs around a boundary. Override
// with CDK_FLOOR_LADDER="2.230.0,2.200.0,…".
const LADDER = (
  process.env.CDK_FLOOR_LADDER ??
  "2.230.0,2.200.0,2.180.0,2.160.0,2.140.0,2.131.0,2.120.0,2.100.0,2.80.0,2.60.0,2.46.0,2.20.0,2.1.0"
).split(",");

function pkgJsonPath(pkg) {
  return join(PACKAGES_DIR, pkg, "package.json");
}

function readFloors() {
  return JSON.parse(readFileSync(MANIFEST, "utf8")).floors;
}

/** Writes each package's peerDependencies.aws-cdk-lib from the curated manifest. */
function apply() {
  for (const [pkg, { floor, peerFloors }] of Object.entries(readFloors())) {
    const path = pkgJsonPath(pkg);
    const json = JSON.parse(readFileSync(path, "utf8"));
    if (json.peerDependencies?.["aws-cdk-lib"] === undefined) {
      console.log(`  ${pkg.padEnd(16)} skipped (no aws-cdk-lib peer — constructs only)`);
      continue;
    }
    json.peerDependencies["aws-cdk-lib"] = `^${floor}`;
    // Lockstep peers (e.g. a version-locked @aws-cdk/aws-*-alpha) are stored exact
    // in the manifest, like `floor`, and written as a caret range here.
    const extras = [];
    for (const [name, version] of Object.entries(peerFloors ?? {})) {
      json.peerDependencies[name] = `^${version}`;
      extras.push(`${name} ^${version}`);
    }
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
    console.log(
      `  ${pkg.padEnd(16)} aws-cdk-lib ^${floor}${extras.length > 0 ? ` + ${extras.join(", ")}` : ""}`,
    );
  }
  console.log("\nApplied to package.json files (run `npm run format` to normalise).");
}

/** Asserts each package.json peer range matches the manifest; non-zero on drift. */
function check() {
  const floors = readFloors();
  const mismatches = [];
  for (const [pkg, { floor, peerFloors }] of Object.entries(floors)) {
    const peers = JSON.parse(readFileSync(pkgJsonPath(pkg), "utf8")).peerDependencies ?? {};
    if (peers["aws-cdk-lib"] !== `^${floor}`) {
      mismatches.push(
        `  ${pkg}: package.json has aws-cdk-lib "${peers["aws-cdk-lib"] ?? "(unset)"}", manifest expects "^${floor}"`,
      );
    }
    for (const [name, version] of Object.entries(peerFloors ?? {})) {
      if (peers[name] !== `^${version}`) {
        mismatches.push(
          `  ${pkg}: package.json has ${name} "${peers[name] ?? "(unset)"}", manifest expects "^${version}"`,
        );
      }
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

/**
 * Lockstep peer overrides (e.g. a version-locked `@aws-cdk/aws-*-alpha`) for each
 * floor, as `{ [floor]: { [peer]: exactVersion } }`. The manifest stores each peer
 * exact (like `floor`), which is exactly what `enforce` pins — without pinning the
 * alpha too, a lowered aws-cdk-lib floor would be probed against a mismatched
 * (latest) alpha and the result would be meaningless.
 */
function peerOverridesByFloor(floors) {
  const byFloor = {};
  for (const { floor, peerFloors } of Object.values(floors)) {
    byFloor[floor] = { ...byFloor[floor], ...peerFloors };
  }
  return byFloor;
}

/** The version of `dep` that `pkgName` actually resolves, from inside its own dir. */
function resolvedVersionFor(pkgName, dep = "aws-cdk-lib") {
  const cwd = join(PACKAGES_DIR, pkgName.replace("@composurecdk/", ""));
  return execFileSync(
    process.execPath,
    ["-e", `process.stdout.write(require(${JSON.stringify(`${dep}/package.json`)}).version)`],
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
  const floors = readFloors();
  const byFloor = groupByFloor(floors);
  const peerByFloor = peerOverridesByFloor(floors);
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
      // Lockstep peers (e.g. a version-locked alpha module) are pinned in the same
      // override so the floor is probed against a coherent peer graph.
      const peerOverrides = peerByFloor[floor] ?? {};
      const manifest = JSON.parse(pkgBackup);
      manifest.overrides = { ...manifest.overrides, "aws-cdk-lib": floor, ...peerOverrides };
      writeFileSync(PKG, `${JSON.stringify(manifest, null, 2)}\n`);
      for (const [name, version] of Object.entries(peerOverrides)) {
        console.log(`  pinning lockstep peer ${name}@${version}`);
      }
      // Both must go for npm to re-resolve under the override: with node_modules
      // present npm reports "up to date", and with the lockfile present it
      // installs the locked (latest) version regardless of the override.
      rmSync(NODE_MODULES, { recursive: true, force: true });
      rmSync(LOCK, { force: true });
      execFileSync("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });

      // Hard gate: confirm every pinned version bound for this group (not a nested
      // latest copy), so the run can never silently pass against the wrong version.
      const sample = group[0];
      for (const [dep, want] of Object.entries({ "aws-cdk-lib": floor, ...peerOverrides })) {
        const got = resolvedVersionFor(sample, dep);
        if (got !== want) {
          throw new Error(
            `pin failed: ${sample} resolves ${dep} ${got}, expected ${want} — ` +
              "the override did not bind (stale node_modules?).",
          );
        }
        console.log(`  ${sample} resolves ${dep} ${got} ✓`);
      }

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

/**
 * Probes whether every packed package can be loaded against aws-cdk-lib at the
 * given version. Creates a throwaway rig with the pinned aws-cdk-lib plus the
 * packed tarballs, npm-installs (`--legacy-peer-deps` so packages whose
 * declared floor exceeds the probed version still install), then dynamically
 * imports each. Returns `[{ name, ok, error? }]` -- one row per package.
 */
function probeAtVersion(version, tarballs, cacheDir) {
  const rig = mkdtempSync(join(cacheDir, `probe-${version.replace(/\./g, "-")}-`));
  const dependencies = { "aws-cdk-lib": version, constructs: CONSTRUCTS_RANGE };
  for (const [name, tarball] of Object.entries(tarballs)) {
    dependencies[name] = `file:${join(cacheDir, tarball)}`;
  }
  writeFileSync(
    join(rig, "package.json"),
    `${JSON.stringify(
      { name: `probe-${version}`, private: true, type: "module", dependencies },
      null,
      2,
    )}\n`,
  );
  try {
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
      cwd: rig,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    const msg = `npm install failed: ${e.message.split("\n")[0]}`;
    return Object.keys(tarballs).map((name) => ({ name, ok: false, error: msg }));
  }
  return Object.keys(tarballs).map((name) => {
    try {
      const probe = `import(${JSON.stringify(name)}).then(() => process.stdout.write("OK"), (e) => process.stdout.write("FAIL:" + (e.message ?? String(e))));`;
      const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
        cwd: rig,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return out.startsWith("OK") ? { name, ok: true } : { name, ok: false, error: out.slice(5) };
    } catch (e) {
      return { name, ok: false, error: e.message.split("\n")[0] };
    }
  });
}

/**
 * Discovers per-package floors by probing each publishable package against a
 * descending ladder of real aws-cdk-lib releases. Writes a ladder-granular
 * draft to `cdk-floors.discovered.json`; refine and copy into
 * `cdk-floors.json` (the curated source of truth) — re-running `establish`
 * never clobbers the curated manifest.
 */
function establish() {
  const cacheDir = mkdtempSync(join(tmpdir(), "composurecdk-floor-tarballs-"));
  try {
    console.log("Packing publishable packages …");
    const tarballs = packPublishablePackages(cacheDir);
    const names = Object.keys(tarballs);

    // results[name] = ordered (high -> low) list of { version, ok, error }
    const results = Object.fromEntries(names.map((n) => [n, []]));
    for (const version of LADDER) {
      process.stdout.write(`Probing aws-cdk-lib@${version} … `);
      const probed = probeAtVersion(version, tarballs, cacheDir);
      for (const { name, ok, error } of probed) results[name].push({ version, ok, error });
      console.log(`${probed.filter((r) => r.ok).length}/${names.length} packages load`);
    }

    const floors = {};
    for (const name of names) {
      const rungs = results[name]; // high -> low
      let floor;
      let gatedBy;
      for (const [i, rung] of rungs.entries()) {
        if (!rung.ok) break;
        floor = rung.version;
        gatedBy = rungs[i + 1]?.error; // why the next rung down fails
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

const mode = process.argv[2];
const modes = { apply, check, enforce, establish };
if (modes[mode] !== undefined) {
  modes[mode]();
} else {
  console.error(
    `Unknown mode "${mode ?? ""}". Usage: node scripts/cdk-floors.mjs <apply|check|enforce|establish>`,
  );
  process.exit(1);
}
