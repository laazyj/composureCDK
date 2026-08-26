import type { Linter } from "eslint";

/**
 * The consumer preset — the rules that encode the `Lifecycle`/builder contract
 * itself, so they hold in any project that writes builders against
 * `@composurecdk/core`, not just this repo.
 *
 * Apply it to the sources that implement builders. Rules that key on this
 * repo's own conventions live in the {@link ./internal.js | `internal`} preset
 * instead, because their premises (a pinned CDK floor, `taggedBuilder`, the
 * constraint catalogue) do not travel.
 *
 * Rule names, messages and severities here are public API: a rule that gets
 * stricter is a breaking change, and a new rule joins this preset at a minor
 * rather than a patch. See the README's versioning section.
 */
export const recommended: Linter.Config = {
  rules: {
    "composurecdk/builder-must-implement-copy-state": "error",
    "composurecdk/lifecycle-build-context-required": "error",
    "composurecdk/lifecycle-build-must-forward-context": "error",
    "composurecdk/no-cjs-incompatible-syntax": "error",
    "composurecdk/no-realm-bound-instanceof": "error",
  },
};
