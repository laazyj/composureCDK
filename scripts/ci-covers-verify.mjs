#!/usr/bin/env node

/**
 * Asserts that every gate in the root `verify` script also runs in CI.
 *
 * `npm run verify` is the pre-push gate and `ci.yml` enumerates its steps
 * individually — two lists of the same thing, and nothing compared them. They
 * had already drifted: `catalogue:check` was verify-only, so a PR that staled
 * the generated catalogue merged green and failed later at someone's push.
 *
 * The check is one-directional. CI may legitimately run more than `verify`
 * does — `coverage:summary`, `cdk-floors:enforce` — so only the reverse is an
 * error.
 *
 * `ci.yml` is scanned with a regex rather than a YAML parse. A parse would mean
 * importing `yaml`, which is present only as a hoisted transitive dependency —
 * the very hoist npm 10 and 11 disagree over, and which the `Pin npm` step in
 * ci.yml exists to settle. Comment lines are dropped first, because this file
 * names gates in prose: without that, a comment mentioning a gate would mark it
 * covered after the step running it had gone.
 *
 * The check proves a step exists, not that it runs on every PR. A step carrying
 * an `if:` counts as covered, so a gate could in principle be guarded out from
 * under this. Worth knowing; not worth parsing conditions for.
 *
 * Usage:
 *   node scripts/ci-covers-verify.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "ci.yml");

/** Every `npm run <script>` named in a string. */
function scriptsIn(text) {
  return [...text.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]);
}

/** The workflow with full-line comments removed — they name gates in prose. */
function withoutComments(yaml) {
  return yaml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function main() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const required = scriptsIn(manifest.scripts.verify);
  const inCi = new Set(scriptsIn(withoutComments(readFileSync(WORKFLOW, "utf8"))));

  const missing = required.filter((script) => !inCi.has(script));
  if (missing.length > 0) {
    console.error(
      `${String(missing.length)} gate(s) run in \`npm run verify\` but not in ci.yml:\n  ` +
        `${missing.join("\n  ")}\n` +
        "Add a step to .github/workflows/ci.yml so the failure surfaces on the PR, " +
        "not at push time.",
    );
    process.exit(1);
  }

  console.log(`ci.yml covers all ${String(required.length)} gates in \`npm run verify\`.`);
}

main();
