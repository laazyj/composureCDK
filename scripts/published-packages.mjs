/**
 * The packages npm will publish, for the gates that check what they ship.
 *
 * A package is published when its manifest sets `publishConfig.access` to
 * `"public"`. Not `files`, which would make the declaration its own authority,
 * and not `private`: `@composurecdk/eslint-plugin` is private today but
 * publishes later, while `@composurecdk/cdk-testing` is private for good.
 * Omitting `publishConfig.access` is the one mistake that already fails
 * loudly, at `npm publish`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages");

/** Every package npm will publish, with its directory and parsed manifest. */
export function published() {
  return readdirSync(PACKAGES)
    .sort()
    .map((name) => join(PACKAGES, name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
    }))
    .filter(({ manifest }) => manifest.publishConfig?.access === "public");
}
