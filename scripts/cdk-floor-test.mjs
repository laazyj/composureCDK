#!/usr/bin/env node

/**
 * aws-cdk-lib floor compatibility harness (composed-synth half).
 *
 * CI installs only the latest aws-cdk-lib, so nothing exercises the older end
 * of the `^2` peer range — which is how the #146 regression (a call to the
 * 2.231-only `CfnAlarm.isCfnAlarm`) shipped undetected.
 *
 * This packs every publishable @composurecdk package, installs them into a
 * throwaway project alongside a *real* pinned aws-cdk-lib, and runs a
 * representative `compose(...).build()` synth against it
 * (scripts/cdk-floor/synth.mjs). A non-zero exit means a published package
 * reaches for a CDK API the floor doesn't have. The companion
 * `cdk-floor-suites.mjs` runs every package's own unit suite at the floor for
 * exhaustive per-package coverage; this half is the always-on integration smoke.
 *
 * Run `npm run build` first (the harness packs from each package's dist).
 * Override the version under test with `CDK_FLOOR=<version> node
 * scripts/cdk-floor-test.mjs`.
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

// The aws-cdk-lib version under test — the highest release that predates the
// `isCfn<Resource>` guards, so it exercises the #146 condition. Lower this as
// the supported floor is established; CDK_FLOOR overrides it ad hoc.
const FLOOR = process.env.CDK_FLOOR ?? "2.230.0";
const CONSTRUCTS_RANGE = "^10.0.0";

/** Every publishable @composurecdk package, so the fixture can import any of them. */
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

function packTarball(dir, destination) {
  const output = execFileSync("npm", ["pack", "--pack-destination", destination], {
    cwd: join(PACKAGES_DIR, dir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"], // capture the tarball name; drop npm's notices
  });
  const tarball = output
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.endsWith(".tgz"));
  if (tarball === undefined)
    throw new Error(`npm pack for ${dir} did not report a .tgz:\n${output}`);
  return tarball;
}

const rig = mkdtempSync(join(tmpdir(), "composurecdk-cdk-floor-"));
try {
  const dependencies = { "aws-cdk-lib": FLOOR, constructs: CONSTRUCTS_RANGE };
  const packed = discoverPublishablePackages();
  for (const { name, dir } of packed) {
    dependencies[name] = `file:./${packTarball(dir, rig)}`;
  }

  writeFileSync(
    join(rig, "package.json"),
    `${JSON.stringify({ name: "cdk-floor-rig", private: true, type: "module", dependencies }, null, 2)}\n`,
  );
  copyFileSync(join(SCRIPT_DIR, "cdk-floor", "synth.mjs"), join(rig, "synth.mjs"));

  console.log(`Installing aws-cdk-lib@${FLOOR} + ${packed.length} packed packages …`);
  // --legacy-peer-deps so a CDK_FLOOR below some package's declared floor still
  // installs (we want to test whether the synth resolves, not the peer ranges).
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
    cwd: rig,
    stdio: "inherit",
  });

  console.log("Synthesising the composed system against the floor …");
  execFileSync(process.execPath, ["synth.mjs"], { cwd: rig, stdio: "inherit" });

  console.log("\n✓ cdk-floor-test passed");
} catch (error) {
  // npm install / synth stream their own output via stdio: "inherit"; surface
  // anything else (e.g. a pack failure captured as a string).
  console.error(`\n✗ cdk-floor-test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(rig, { recursive: true, force: true });
}
