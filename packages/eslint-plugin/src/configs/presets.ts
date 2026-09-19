import type { Linter } from "eslint";

/**
 * The rule sets behind each preset, grouped by **what must be true of the
 * consumer** for the rule to be correct — not by subject matter. Every rule
 * belongs to exactly one, which a test enforces.
 *
 * The reasoning behind the tiers, and what moving a rule between them costs,
 * is in ADR-0019.
 */

/**
 * True for anyone writing a `Lifecycle` or a builder, in any shape of project —
 * an application as much as a library.
 */
export const recommendedRules: Linter.RulesRecord = {
  "composurecdk/builder-must-implement-copy-state": "error",
  "composurecdk/lifecycle-build-context-required": "error",
  "composurecdk/no-realm-bound-instanceof": "error",
};

/**
 * Additionally true for a package other people compile against.
 *
 * Each hazard here exists only once you emit a `.d.ts` someone else consumes:
 * TS4094 and TS2883 need an exported mapped type, and a narrowed prop type only
 * hurts when it is your published API. An application emits none of that.
 *
 * `lifecycle-build-must-forward-context` sits here for a different reason — a
 * root-level build has no context to forward and is correct, and in an
 * application nearly every build is a root build. That is a property of where
 * the call sits in the composition graph, so no amount of narrowing the rule
 * fixes it.
 */
export const libraryAuthorRules: Linter.RulesRecord = {
  "composurecdk/lifecycle-build-must-forward-context": "error",
  "composurecdk/no-typescript-private-modifier": "error",
  "composurecdk/redeclared-prop-must-track-cdk-type": "error",
};

/**
 * Additionally true for a package shipping both an ESM and a CommonJS build.
 * Out of `recommended` because banning `import.meta` is a false positive for an
 * ESM-only library, where it is legal and idiomatic.
 */
export const dualPublishingRules: Linter.RulesRecord = {
  "composurecdk/no-cjs-incompatible-syntax": "error",
};

/**
 * composureCDK's own house rules. Each encodes a convention or a hardcoded
 * value — this repo's CDK floor, its tagging wrapper, its constraint catalogue
 * — that is wrong elsewhere. Published so the preset is reproducible, not as a
 * recommendation.
 */
export const internalRules: Linter.RulesRecord = {
  "composurecdk/builder-must-be-tagged": "error",
  "composurecdk/constraint-metadata-required": "error",
  "composurecdk/no-cdk-api-above-floor": "error",
};
