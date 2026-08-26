import { describe, expect, it } from "vitest";
import { configs, rules } from "../src/index.js";

const CONSUMER_RULES = [
  "builder-must-implement-copy-state",
  "lifecycle-build-context-required",
  "lifecycle-build-must-forward-context",
  "no-cjs-incompatible-syntax",
  "no-realm-bound-instanceof",
];

const INTERNAL_ONLY_RULES = [
  "builder-must-be-tagged",
  "constraint-metadata-required",
  "no-cdk-api-above-floor",
];

const prefixed = (names: string[]): string[] => names.map((name) => `composurecdk/${name}`).sort();

const ruleNamesIn = (config: { rules?: object }): string[] =>
  Object.keys(config.rules ?? {})
    .filter((name) => name.startsWith("composurecdk/"))
    .sort();

/**
 * The split between the presets is the public-API decision of this package
 * (issue #409), so it is asserted rather than left to review: `recommended`
 * carries the rules that encode the Lifecycle/builder contract and travel to
 * any consumer, `internal` adds the ones whose premises are local to this repo.
 *
 * The lists above are deliberately spelled out rather than derived from the
 * presets — a rule that changes side has to be changed here too, which is the
 * point at which the semver consequence gets considered.
 */
describe("presets", () => {
  it("exposes only the consumer rules in `recommended`", () => {
    expect(ruleNamesIn(configs.recommended)).toEqual(prefixed(CONSUMER_RULES));
  });

  it("adds the repo-specific rules in `internal`", () => {
    expect(ruleNamesIn(configs.internal)).toEqual(
      prefixed([...CONSUMER_RULES, ...INTERNAL_ONLY_RULES]),
    );
  });

  it("enables every registered rule somewhere, so a new rule cannot be forgotten", () => {
    expect(ruleNamesIn(configs.internal)).toEqual(prefixed(Object.keys(rules)));
  });

  it("bans the TypeScript `private` modifier for this repo only", () => {
    expect(configs.internal.rules?.["no-restricted-syntax"]).toBeDefined();
    expect(configs.recommended.rules?.["no-restricted-syntax"]).toBeUndefined();
  });
});
