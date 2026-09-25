#!/usr/bin/env node

/**
 * Asserts that every gate the `verify` target depends on also runs in CI.
 *
 * `nx verify workspace-root` is the pre-push gate and `ci.yml` enumerates its
 * gates as individual steps — two lists of the same thing, and nothing compared
 * them. They had already drifted: `catalogue:check` was verify-only, so a PR
 * that staled the generated catalogue merged green and failed later at
 * someone's push.
 *
 * The check is one-directional. CI may legitimately run more than `verify`
 * does — `coverage:summary`, `cdk-floors:enforce` — so only the reverse is an
 * error.
 *
 * `verify`'s gates come from project.json; `ci.yml` is scanned with a regex
 * rather than parsed, because a YAML parse would mean importing `yaml`, which
 * is present only as a hoisted transitive dependency — the very hoist npm 10
 * and 11 disagree over, and which the root `engines` field exists to settle.
 * Comment lines are dropped first, because this file names gates in prose:
 * without that, a comment mentioning a gate would mark it covered after the
 * step running it had gone.
 *
 * All three nx spellings count — `nx run-many -t a b`, `nx <target>` and
 * `nx run <project>:<target>` — so this check constrains what CI *covers*, not
 * how CI is written.
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
const PROJECT = join(ROOT, "project.json");

/** The gates `verify` depends on, whether named directly or fanned out over projects. */
function gatesInVerify() {
  const { targets } = JSON.parse(readFileSync(PROJECT, "utf8"));
  return targets.verify.dependsOn.map((entry) =>
    typeof entry === "string" ? entry : entry.target,
  );
}

/** Every nx target named in a string, in any of the three invocation spellings. */
function targetsIn(text) {
  const target = String.raw`[a-z][\w.:-]*`;
  return [
    // `nx run-many -t a b c`
    ...[
      ...text.matchAll(new RegExp(String.raw`nx run-many -t ((?:${target}\s+)*${target})`, "g")),
    ].flatMap((match) => match[1].split(/\s+/)),
    // `nx run <project>:<target>`
    ...[...text.matchAll(new RegExp(String.raw`nx run [\w@/.-]+:(${target})`, "g"))].map(
      (match) => match[1],
    ),
    // `nx <target>`, optionally followed by a project
    ...[...text.matchAll(new RegExp(String.raw`nx (?!run-many\b|run\b)(${target})`, "g"))].map(
      (match) => match[1],
    ),
  ];
}

/** The workflow with full-line comments removed — they name gates in prose. */
function withoutComments(yaml) {
  return yaml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function main() {
  const required = gatesInVerify();
  const inCi = new Set(targetsIn(withoutComments(readFileSync(WORKFLOW, "utf8"))));

  const missing = required.filter((target) => !inCi.has(target));
  if (missing.length > 0) {
    console.error(
      `${String(missing.length)} gate(s) run in \`nx verify\` but not in ci.yml:\n  ` +
        `${missing.join("\n  ")}\n` +
        "Add a step to .github/workflows/ci.yml so the failure surfaces on the PR, " +
        "not at push time.",
    );
    process.exit(1);
  }

  console.log(`ci.yml covers all ${String(required.length)} gates in \`nx verify\`.`);
}

main();
