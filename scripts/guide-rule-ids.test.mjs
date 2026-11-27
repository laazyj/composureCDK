/**
 * Keeps the documents written from the catalogue of principles in step with
 * it. `docs/guide/principles.md` is the source of truth: each rule is a
 * `### ID: …` heading there. The agent rules shipped in `@composurecdk/core`
 * must carry every rule exactly once, and no document may cite a rule ID the
 * catalogue doesn't define. `llms.txt` is checked here too, because its links
 * point into the docs and no other gate reads it.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const AGENT_RULES = "packages/core/docs/agent-rules.md";
const CITING = [
  AGENT_RULES,
  "packages/core/docs/review-rubric.md",
  "docs/guide/architecting-an-app.md",
  "docs/architecture.md",
];

const catalogue = [...read("docs/guide/principles.md").matchAll(/^### ([A-Z]+-\d+):/gm)].map(
  (m) => m[1],
);
const defined = new Set(catalogue);

/** A rule ID, with one of the prefixes the catalogue uses, so `UTF-8` or `ADR-0001` never match. */
const prefixes = [...new Set(catalogue.map((id) => id.split("-")[0]))];
const RULE_ID = new RegExp(`\\b(?:${prefixes.join("|")})-\\d+\\b`, "g");

it("the catalogue defines each rule ID once", () => {
  assert.ok(catalogue.length > 0, "no rules found in the catalogue");
  assert.equal(defined.size, catalogue.length);
});

it("the agent rules list every rule in the catalogue exactly once", () => {
  const listed = [...read(AGENT_RULES).matchAll(/^- \*\*([A-Z]+-\d+)\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(listed.sort(), [...catalogue].sort());
});

for (const path of CITING) {
  it(`${path} cites only rule IDs the catalogue defines`, () => {
    const cited = new Set(read(path).match(RULE_ID));
    assert.deepEqual(
      [...cited].filter((id) => !defined.has(id)),
      [],
    );
  });
}

it("llms.txt links only to files that exist", () => {
  const targets = [
    ...read("llms.txt").matchAll(
      /github\.com\/laazyj\/composureCDK\/(?:blob|tree)\/main\/([^)#\s]+)/g,
    ),
  ].map((m) => m[1]);
  assert.ok(targets.length > 0, "no repository links found in llms.txt");
  assert.deepEqual(
    targets.filter((target) => !existsSync(join(ROOT, target))),
    [],
  );
});
