#!/usr/bin/env node

/**
 * `consumer:pack` / `consumer:check` — run @composurecdk/module-compat's
 * consumer checks against the packed packages, as a consumer would install
 * them. See docs/ci.md#consumer-compatibility.
 *
 * - `pack <dir>` npm-packs every publishable package into `<dir>`. Needs a
 *   build first: `files` ships `dist`.
 * - `check <dir>` installs `<dir>/*.tgz` into a fresh project, with their
 *   external peers at the versions package-lock.json pins, then runs
 *   `packages/module-compat/check.mjs` against that install.
 *
 * Built-ins only, so CI runs `check` with plain `node` on every supported Node.
 *
 * Usage:
 *   node scripts/consumer-compat.mjs <pack|check> <dir>
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packPublishablePackages } from "./cdk-floor/packages.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_COMPAT = join(REPO_ROOT, "packages", "module-compat");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function pack(dir) {
  mkdirSync(dir, { recursive: true });
  const names = Object.keys(packPublishablePackages(resolve(dir)));
  // check.mjs probes module-compat's peers, so a package missing there would
  // be packed and installed but never loaded.
  const peers = readJson(join(MODULE_COMPAT, "package.json")).peerDependencies;
  const unlisted = names.filter((name) => !(name in peers));
  if (unlisted.length > 0) {
    fail(`not in @composurecdk/module-compat's peerDependencies: ${unlisted.join(", ")}`);
  }
  console.log(`Packed ${String(names.length)} packages into ${dir}.`);
}

/** Every external peer the publishable packages declare, at its lockfile version. */
function externalPeers() {
  const lock = readJson(join(REPO_ROOT, "package-lock.json")).packages;
  const peers = {};
  for (const [path, entry] of Object.entries(lock)) {
    if (!path.startsWith("packages/") || entry.private === true) continue;
    for (const peer of Object.keys(entry.peerDependencies ?? {})) {
      if (peer.startsWith("@composurecdk/")) continue;
      const version = lock[`node_modules/${peer}`]?.version;
      if (version === undefined) fail(`package-lock.json has no hoisted ${peer}`);
      peers[peer] = version;
    }
  }
  return Object.entries(peers).map(([name, version]) => `${name}@${version}`);
}

function check(dir) {
  const tarballs = readdirSync(dir)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => join(resolve(dir), file));
  if (tarballs.length === 0) fail(`no .tgz files in ${dir}; run \`pack\` first`);

  const project = mkdtempSync(join(tmpdir(), "composurecdk-consumer-"));
  try {
    writeFileSync(join(project, "package.json"), '{ "private": true }\n');
    console.log(`Node ${process.version}: installing ${String(tarballs.length)} packages …`);
    // No --legacy-peer-deps: a consumer's install enforces the peer ranges.
    const install = spawnSync(
      "npm",
      ["install", "--no-audit", "--no-fund", ...tarballs, ...externalPeers()],
      { cwd: project, stdio: "inherit" },
    );
    if (install.status !== 0) {
      // Not fail(): process.exit() would skip the cleanup below.
      console.error(
        "✗ npm install failed: a consumer could not install these packages (npm's output is above).",
      );
      process.exitCode = 1;
      return;
    }
    const run = spawnSync(process.execPath, [join(MODULE_COMPAT, "check.mjs"), project], {
      stdio: "inherit",
    });
    process.exitCode = run.status ?? 1;
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

const [command, dir] = process.argv.slice(2);
if (dir === undefined || (command !== "pack" && command !== "check")) {
  fail("usage: node scripts/consumer-compat.mjs <pack|check> <dir>");
}
if (command === "pack") pack(dir);
else check(dir);
