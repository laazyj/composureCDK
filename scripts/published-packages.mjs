/**
 * The packages npm will publish. Every script that needs that set imports it
 * from here, so they cannot disagree about it.
 *
 * A package declares it twice: nx release skips one marked `"private": true`,
 * and npm publishes a scoped package only with `publishConfig.access` set to
 * `"public"`. The set is keyed on `publishConfig.access`, and `published()`
 * throws if any package sets both fields or neither, so the two declarations
 * cannot drift apart. Not keyed on `files`, which would make the declaration
 * its own authority.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages");

/** Every package npm will publish, with its directory and parsed manifest. */
export function published() {
  const packages = readdirSync(PACKAGES)
    .sort()
    .map((name) => join(PACKAGES, name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
    }));
  const isPublic = ({ manifest }) => manifest.publishConfig?.access === "public";

  const ambiguous = packages.filter((pkg) => (pkg.manifest.private === true) === isPublic(pkg));
  if (ambiguous.length > 0) {
    throw new Error(
      `${ambiguous.map(({ manifest }) => manifest.name).join(", ")}: set exactly one of ` +
        `"private": true or "publishConfig": { "access": "public" } (see docs/ci.md#versioning)`,
    );
  }
  return packages.filter(isPublic);
}
