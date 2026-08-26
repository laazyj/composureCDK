import type { Linter } from "eslint";
import { NAMESPACE, plugin } from "../plugin.js";

/**
 * The consumer preset — the rules that encode the `Lifecycle`/builder contract
 * itself, so they hold in any project that writes builders against
 * `@composurecdk/core`, not just this repo. Rules that key on this repo's own
 * conventions live in `internal` instead.
 *
 * Spread into a config object that scopes it to the sources implementing
 * builders; it registers the plugin itself, so there is no `plugins` block to
 * get wrong:
 *
 * ```js
 * { files: ["src/**\/*.ts"], ...composurecdk.configs.recommended }
 * ```
 *
 * Its membership, rule messages and severities are public API — see the
 * README's versioning section before changing any of them.
 */
export const recommended: Linter.Config = {
  plugins: { [NAMESPACE]: plugin },
  rules: {
    "composurecdk/builder-must-implement-copy-state": "error",
    "composurecdk/lifecycle-build-context-required": "error",
    "composurecdk/lifecycle-build-must-forward-context": "error",
    "composurecdk/no-cjs-incompatible-syntax": "error",
    "composurecdk/no-realm-bound-instanceof": "error",
  },
};
