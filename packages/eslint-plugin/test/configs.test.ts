import { describe, expect, it } from "vitest";
import { configs, rules } from "../src/index.js";
import { NAMESPACE } from "../src/plugin.js";

/**
 * What each consumer-facing preset exposes. Spelled out rather than derived,
 * because this membership is the public-API decision of the package (issue
 * #409): a rule joining a preset is a minor release, and a rule leaving one —
 * or moving between them — is breaking for anyone who had it on. The map is
 * the point at which that consequence has to be considered; no assertion can
 * make the decision for you, but none of it can happen silently either.
 *
 * `internal` needs no list of its own; it is asserted against the whole
 * registry, so internal-only is whatever is not below.
 */
const CONSUMER_PRESETS = {
  recommended: [
    "builder-must-implement-copy-state",
    "lifecycle-build-context-required",
    "lifecycle-build-must-forward-context",
    "no-realm-bound-instanceof",
  ],
  dualPublishing: ["no-cjs-incompatible-syntax"],
};

const prefixed = (names: readonly string[]): string[] =>
  names.map((name) => `${NAMESPACE}/${name}`).sort();

const ruleNamesIn = (config: { rules?: object }): string[] =>
  Object.keys(config.rules ?? {})
    .filter((name) => name.startsWith(`${NAMESPACE}/`))
    .sort();

const consumerConfigs = Object.keys(CONSUMER_PRESETS).map(
  (name) => configs[name as keyof typeof CONSUMER_PRESETS],
);

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
    const enabled = consumerConfigs.flatMap(ruleNamesIn);
    expect(enabled).toEqual([...new Set(enabled)]);
  });

  it("enables every registered rule in `internal`, so a new rule cannot be forgotten", () => {
    expect(ruleNamesIn(configs.internal)).toEqual(prefixed(Object.keys(rules)));
  });

  it("bans the TypeScript `private` modifier for this repo only", () => {
    expect(configs.internal.rules?.["no-restricted-syntax"]).toBeDefined();
    for (const config of consumerConfigs) {
      expect(config.rules?.["no-restricted-syntax"]).toBeUndefined();
    }
  });

  it("registers the plugin itself, so a spread config needs no `plugins` block", () => {
    for (const config of [...consumerConfigs, configs.internal]) {
      expect(config.plugins?.[NAMESPACE]?.rules).toBe(rules);
    }
  });
});
