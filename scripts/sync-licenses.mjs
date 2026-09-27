#!/usr/bin/env node

/**
 * Keeps every published package shipping the files it claims to.
 *
 * npm resolves `files` entries relative to the package directory and does not
 * look up the tree, so a package listing `LICENSE` without holding the file
 * publishes without it — silently. Every package here did exactly that.
 *
 * The set of published packages is taken from `publishConfig.access`, not from
 * `files` and not from `private`. Keying on `files` would make the declaration
 * its own authority: a new package that simply forgot to list `LICENSE` would
 * pass. `private` is the wrong axis too — `@composurecdk/eslint-plugin` is
 * private today but publishes later, while `@composurecdk/cdk-testing` is
 * private for good. Omitting `publishConfig.access` is the one mistake that
 * already fails loudly, at `npm publish`, so deriving from it makes the silent
 * failures checkable.
 *
 * Checks, for each published package: `LICENSE` is listed in `files`, the file
 * is present and identical to the root one, and every other `files` entry
 * resolves to something on disk — which catches a renamed README or a stale
 * directory entry, not just this instance.
 *
 * - default: write the missing or stale `LICENSE` copies.
 * - `--check`: exit non-zero on any problem. Wired into `npx nx verify`, so
 *   the root licence cannot change without the copies following it.
 *
 * Usage:
 *   node scripts/sync-licenses.mjs
 *   node scripts/sync-licenses.mjs --check
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "LICENSE");
const PACKAGES = join(ROOT, "packages");

/** Every package npm will publish, with its parsed manifest. */
function published() {
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

/** Problems that this script cannot fix by copying — a human has to edit the manifest. */
function manifestProblems({ dir, manifest }) {
  const name = relative(ROOT, dir);
  const files = manifest.files ?? [];
  const problems = [];

  if (!files.includes("LICENSE")) {
    problems.push(`${name}: is published but does not list "LICENSE" in "files"`);
  }
  for (const entry of files) {
    if (entry !== "LICENSE" && !existsSync(join(dir, entry))) {
      problems.push(`${name}: "files" lists "${entry}", which does not exist`);
    }
  }
  return problems;
}

function main() {
  const check = process.argv.includes("--check");
  const licence = readFileSync(SOURCE, "utf8");
  const packages = published();

  const problems = packages.flatMap((pkg) => manifestProblems(pkg));
  const stale = packages.filter(({ dir }) => {
    const copy = join(dir, "LICENSE");
    return !existsSync(copy) || readFileSync(copy, "utf8") !== licence;
  });

  if (check) {
    const missing = stale.map(
      ({ dir }) => `${relative(ROOT, dir)}: LICENSE missing or out of date`,
    );
    const all = [...problems, ...missing];
    if (all.length > 0) {
      console.error(
        `${String(all.length)} problem(s) across ${String(packages.length)} published packages:\n  ` +
          `${all.join("\n  ")}\n` +
          "Run `npx nx licenses` to refresh the copies; manifest problems need an edit.",
      );
      process.exit(1);
    }
    console.log(`${String(packages.length)} published packages ship the files they declare.`);
    return;
  }

  for (const { dir } of stale) writeFileSync(join(dir, "LICENSE"), licence);
  console.log(
    `Synced LICENSE into ${String(stale.length)} of ${String(packages.length)} published packages.`,
  );
  if (problems.length > 0) {
    console.error(
      `\n${String(problems.length)} manifest problem(s) need an edit:\n  ` + problems.join("\n  "),
    );
    process.exit(1);
  }
}

main();
