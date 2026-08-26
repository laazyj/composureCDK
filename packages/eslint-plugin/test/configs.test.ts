import { describe, expect, it } from "vitest";
import { configs, rules } from "../src/index.js";
import { NAMESPACE } from "../src/plugin.js";

/**
 * The rules `recommended` exposes. Spelled out rather than derived, because
 * this list is the public-API decision of the package (issue #409): a rule
 * joining it is a minor release, and a rule leaving it is a breaking one.
 * `internal` is asserted against the whole registry instead, so it needs no
 * second list — internal-only is whatever is not here.
 */
const CONSUMER_RULES = [
  "builder-must-implement-copy-state",
  "lifecycle-build-context-required",
  "lifecycle-build-must-forward-context",
  "no-cjs-incompatible-syntax",
  "no-realm-bound-instanceof",
];

const prefixed = (names: string[]): string[] => names.map((name) => `${NAMESPACE}/${name}`).sort();

const ruleNamesIn = (config: { rules?: object }): string[] =>
  Object.keys(config.rules ?? {})
    .filter((name) => name.startsWith(`${NAMESPACE}/`))
    .sort();

describe("presets", () => {
  it("exposes only the consumer rules in `recommended`", () => {
    expect(ruleNamesIn(configs.recommended)).toEqual(prefixed(CONSUMER_RULES));
  });

  it("enables every registered rule in `internal`, so a new rule cannot be forgotten", () => {
    expect(ruleNamesIn(configs.internal)).toEqual(prefixed(Object.keys(rules)));
  });

  it("bans the TypeScript `private` modifier for this repo only", () => {
    expect(configs.internal.rules?.["no-restricted-syntax"]).toBeDefined();
    expect(configs.recommended.rules?.["no-restricted-syntax"]).toBeUndefined();
  });

  it("registers the plugin itself, so a spread config needs no `plugins` block", () => {
    for (const config of [configs.recommended, configs.internal]) {
      expect(config.plugins?.[NAMESPACE]?.rules).toBe(rules);
    }
  });
});
