import { describe, expect, it } from "vitest";
import { configs, rules } from "../src/index.js";
import { NAMESPACE } from "../src/plugin.js";

/**
 * What each consumer-facing preset exposes. Spelled out rather than derived,
 * because this membership is the public-API decision of the package (issue
 * #409): a rule joining a preset is a minor release, and a rule leaving one is
 * breaking. `internal` is asserted against the whole registry instead, so it
 * needs no list of its own — internal-only is whatever is not below.
 */
const CONSUMER_PRESETS = {
  recommended: [
    "builder-must-implement-copy-state",
    "lifecycle-build-context-required",
    "lifecycle-build-must-forward-context",
  ],
  dualPublishing: ["no-cjs-incompatible-syntax", "no-realm-bound-instanceof"],
};

const prefixed = (names: string[]): string[] => names.map((name) => `${NAMESPACE}/${name}`).sort();

const ruleNamesIn = (config: { rules?: object }): string[] =>
  Object.keys(config.rules ?? {})
    .filter((name) => name.startsWith(`${NAMESPACE}/`))
    .sort();

describe("presets", () => {
  it.each(Object.entries(CONSUMER_PRESETS))(
    "exposes only its own rules in `%s`",
    (name, expected) => {
      expect(ruleNamesIn(configs[name as keyof typeof CONSUMER_PRESETS])).toEqual(
        prefixed(expected),
      );
    },
  );

  it("keeps the consumer presets disjoint, so neither re-reports the other's rules", () => {
    const [first, second] = Object.values(CONSUMER_PRESETS);
    expect(first.filter((rule) => second.includes(rule))).toEqual([]);
  });

  it("enables every registered rule in `internal`, so a new rule cannot be forgotten", () => {
    expect(ruleNamesIn(configs.internal)).toEqual(prefixed(Object.keys(rules)));
  });

  it("bans the TypeScript `private` modifier for this repo only", () => {
    expect(configs.internal.rules?.["no-restricted-syntax"]).toBeDefined();
    expect(configs.recommended.rules?.["no-restricted-syntax"]).toBeUndefined();
    expect(configs.dualPublishing.rules?.["no-restricted-syntax"]).toBeUndefined();
  });

  it("registers the plugin itself, so a spread config needs no `plugins` block", () => {
    for (const config of [configs.recommended, configs.dualPublishing, configs.internal]) {
      expect(config.plugins?.[NAMESPACE]?.rules).toBe(rules);
    }
  });
});
