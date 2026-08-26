import type { Linter } from "eslint";
import { NAMESPACE, plugin } from "../plugin.js";

/**
 * The consumer preset — the rules that encode the `Lifecycle`/builder contract
 * itself, so they hold for anyone writing a builder against
 * `@composurecdk/core` whatever their project's shape.
 *
 * Nothing here is conditional on how the code is packaged or on this repo's
 * conventions: the rules that only bind a project publishing dual ESM/CJS live
 * in `dualPublishing`, and the ones whose premises hold only here live in
 * `internal`. A preset whose docs have to tell a slice of readers to switch a
 * rule off teaches them to distrust the whole plugin, so those stay opt-in.
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
  },
};
