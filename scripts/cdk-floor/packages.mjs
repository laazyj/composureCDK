// Shared helper for the cdk-floor diagnostic scripts. Used by both
// `cdk-floors.mjs` (the `establish` mode) and `cdk-floor-validate.mjs`.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages");

/**
 * `npm pack`s every publishable `@composurecdk/*` package into `destination`
 * and returns `{ packageName: tarballFilename }`, so probes install the actual
 * publishable artefact rather than the in-tree source.
 */
export function packPublishablePackages(destination) {
  const tarballs = {};
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, entry.name, "package.json"), "utf8"));
    } catch {
      continue; // not a package directory
    }
    if (!pkg.name?.startsWith("@composurecdk/") || pkg.private === true) continue;
    const output = execFileSync("npm", ["pack", "--pack-destination", destination], {
      cwd: join(PACKAGES_DIR, entry.name),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const tarball = output
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.endsWith(".tgz"));
    if (tarball === undefined) throw new Error(`npm pack for ${entry.name} produced no .tgz`);
    tarballs[pkg.name] = tarball;
  }
  return tarballs;
}
