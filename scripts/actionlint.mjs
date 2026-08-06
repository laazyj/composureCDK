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
 * So this script refuses to lint until it has proven shellcheck runs, probing
 * the same name actionlint will resolve from the same PATH. A skipped check
 * must fail, not pass quietly.
 *
 * shellcheck is the one tool here that comes from PATH rather than npm;
 * docs/ci.md#linting-the-workflows has the why.
 *
 * Any arguments are ignored: actionlint discovers every workflow itself, and a
 * workflow is not valid or invalid file-by-file. `lint-staged` therefore lints
 * the whole directory whenever any workflow is staged.
 *
 * Usage:
 *   node scripts/actionlint.mjs
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Chosen floor, not a verified one: old enough that every current distro and
 * Homebrew clears it, new enough to reject the 0.7.x that Debian bullseye and
 * Ubuntu 20.04 still ship. Raise it when a check we rely on needs it.
 */
const MINIMUM_SHELLCHECK = "0.9.0";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// spawnSync rather than the execFileSync used elsewhere in scripts/: a non-zero
// exit is the expected outcome here and must be forwarded, not thrown.
const spawn = (command, args, stdio = "inherit") =>
  spawnSync(command, args, { cwd: repoRoot, stdio, encoding: "utf8" });

function fail(...lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

/** SemVer compare (assumes plain `MAJOR.MINOR.PATCH`, no pre-release tags). */
function compareSemver(a, b) {
  const [a0, a1, a2] = a.split(".").map(Number);
  const [b0, b1, b2] = b.split(".").map(Number);
  return a0 - b0 || a1 - b1 || a2 - b2;
}

const INSTALL_HINT = [
  "  macOS          brew install shellcheck",
  "  Debian/Ubuntu  sudo apt-get install shellcheck",
  "  other          https://github.com/koalaman/shellcheck#installing",
  "Do not skip the check instead — without shellcheck, actionlint reports a clean run",
  "regardless of what the workflows contain.",
];

// Resolving shellcheck and proving it runs are the same step: `--version` fails
// the same way for a missing binary, an unexecutable one, and a wrong-arch one.
const probe = spawn("shellcheck", ["--version"], "pipe");
if (probe.status !== 0) {
  fail(
    `actionlint: shellcheck is required but will not run (${probe.error?.message ?? `exit ${probe.status}`}).`,
    "Install it and retry:",
    ...INSTALL_HINT,
  );
}

// "version: 0.11.0" — absent only if the output format changed under us, which
// is worth failing on rather than guessing a version we cannot read.
const version = /^version: (\d+\.\d+\.\d+)/m.exec(probe.stdout)?.[1];
if (!version) {
  fail("actionlint: could not read a version from `shellcheck --version`.", probe.stdout.trim());
}
if (compareSemver(version, MINIMUM_SHELLCHECK) < 0) {
  fail(
    `actionlint: shellcheck ${version} is older than the required ${MINIMUM_SHELLCHECK}.`,
    "Upgrade it and retry:",
    ...INSTALL_HINT,
  );
}

const manifest = require.resolve("github-actionlint/package.json");
const actionlint = resolve(dirname(manifest), require(manifest).bin["github-actionlint"]);

// Passing -shellcheck is not redundant with actionlint's default: were that
// default ever to change, the probe above would still pass and the gate would
// go hollow — the exact failure this script exists to prevent.
process.exit(spawn(process.execPath, [actionlint, "-shellcheck=shellcheck"]).status ?? 1);
