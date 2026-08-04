#!/usr/bin/env node

/**
 * `actionlint` — lint the GitHub Actions workflows in `.github/workflows/`.
 *
 * Wraps `actionlint` (via the `github-actionlint` npm package, which fetches
 * the official release binary) so the gate runs identically from a developer's
 * `npm run verify` and from CI — see docs/ci.md#linting-the-workflows.
 *
 * The wrapper exists because actionlint treats shellcheck as *optional*: it
 * shells out to shellcheck only if it can find it, and silently reports a
 * clean run when it cannot. That is worse than it sounds here — every finding
 * this repo currently has comes from shellcheck rather than actionlint's own
 * checks, so a missing shellcheck does not weaken the gate, it empties it.
 * Both of these exit 0 with no output:
 *
 *   actionlint                            # shellcheck not on PATH
 *   actionlint -shellcheck=/nonexistent   # explicit path resolving to nothing
 *
 * So this script refuses to lint until it has proven shellcheck runs, and
 * resolves both binaries from the installed packages rather than from PATH,
 * which would silently pick up an unpinned copy. A skipped check must fail,
 * not pass quietly.
 *
 * Any arguments are ignored: actionlint discovers every workflow itself, and a
 * workflow is not valid or invalid file-by-file. `lint-staged` therefore lints
 * the whole directory whenever any workflow is staged.
 *
 * Usage:
 *   node scripts/actionlint.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Resolve a package's same-named `bin` entry to an absolute path. */
function binOf(pkg) {
  const manifestPath = require.resolve(`${pkg}/package.json`);
  const relative = require(manifestPath).bin?.[pkg];
  if (!relative) {
    throw new Error(`${pkg} declares no "${pkg}" bin — has the package changed?`);
  }
  return resolve(dirname(manifestPath), relative);
}

function fail(...lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

// spawnSync rather than the execFileSync used elsewhere in scripts/: a non-zero
// exit is the expected outcome here and must be forwarded, not thrown.
const spawn = (command, args, stdio = "inherit") =>
  spawnSync(command, args, { cwd: repoRoot, stdio, encoding: "utf8" });

const shellcheckWrapper = binOf("shellcheck");
const shellcheckBin = resolve(dirname(shellcheckWrapper), "shellcheck");

// The wrapper downloads the native binary on demand, but loading its download
// machinery costs ~100ms, so it is invoked only when there is nothing to run.
if (!existsSync(shellcheckBin)) {
  const download = spawn(process.execPath, [shellcheckWrapper, "--version"], "pipe");
  if (download.status !== 0 || !existsSync(shellcheckBin)) {
    fail(
      "actionlint: shellcheck is pinned as a devDependency but could not be installed.",
      (download.stderr || download.stdout || "").trim(),
      "Run `npm ci` and retry; if the download is blocked, fix network access rather than",
      "skipping the check — without shellcheck, actionlint reports a clean run regardless",
      "of what the workflows contain.",
    );
  }
}

// Prove it actually executes. A path that resolves to nothing, or a binary that
// will not run, would otherwise make actionlint silently skip every shell check.
const probe = spawn(shellcheckBin, ["--version"], "pipe");
if (probe.status !== 0) {
  fail(
    `actionlint: shellcheck will not run (${probe.error?.message ?? `exit ${probe.status}`}).`,
    (probe.stderr || probe.stdout || "").trim(),
    "Reinstall with `npm ci`. Do not fall back to a PATH lookup, which silently finds an",
    "unpinned copy, or nothing at all.",
  );
}

const result = spawn(process.execPath, [
  binOf("github-actionlint"),
  `-shellcheck=${shellcheckBin}`,
]);
process.exit(result.status ?? 1);
