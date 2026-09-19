import type { Linter } from "eslint";

/**
 * Rule severities for the `recommended` preset, which
 * {@link ../index.ts | `index.ts`} wraps into a flat config entry.
 *
 * These encode ComposureCDK architectural invariants and are written for
 * library source — apply them to source files, not tests or config. The preset
 * deliberately declares no `files`, since only the consumer knows where their
 * library source lives. File-level overrides (e.g. for the `tagged-builder.ts`
 * implementation itself) likewise belong in the consumer's config, not here.
 */
export const recommendedRules: Linter.RulesRecord = {
  "composurecdk/builder-must-be-tagged": "error",
  "composurecdk/builder-must-implement-copy-state": "error",
  "composurecdk/constraint-metadata-required": "error",
  "composurecdk/lifecycle-build-context-required": "error",
  "composurecdk/lifecycle-build-must-forward-context": "error",
  "composurecdk/no-cdk-api-above-floor": "error",
  "composurecdk/no-cjs-incompatible-syntax": "error",
  "composurecdk/no-realm-bound-instanceof": "error",
  "composurecdk/no-typescript-private-modifier": "error",
  "composurecdk/redeclared-prop-must-track-cdk-type": "error",
};
