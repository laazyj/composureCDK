// Shared helpers for the scripts that install the packed packages:
// `cdk-floors.mjs` (the `establish` mode), `cdk-floor-validate.mjs` and
// `consumer-compat.mjs`.

import { execFileSync } from "node:child_process";
import { published } from "../published-packages.mjs";

/** SemVer compare (assumes plain `MAJOR.MINOR.PATCH`, no pre-release tags). */
export function compareSemver(a, b) {
  const [a0, a1, a2] = a.split(".").map(Number);
  const [b0, b1, b2] = b.split(".").map(Number);
  return a0 - b0 || a1 - b1 || a2 - b2;
}

/**
 * `npm pack`s every published package into `destination` and returns
 * `{ packageName: tarballFilename }`, so probes install the actual
 * publishable artefact rather than the in-tree source.
 */
export function packPublishablePackages(destination) {
  const tarballs = {};
  for (const { dir, manifest } of published()) {
    const output = execFileSync("npm", ["pack", "--pack-destination", destination], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const tarball = output
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.endsWith(".tgz"));
    if (tarball === undefined) throw new Error(`npm pack for ${manifest.name} produced no .tgz`);
    tarballs[manifest.name] = tarball;
  }
  return tarballs;
}
