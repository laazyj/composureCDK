import type { Linter } from "eslint";
import { NAMESPACE, plugin } from "../plugin.js";

/**
 * The rules that hold for a project publishing its builders as a dual ESM/CJS
 * package, as this library does (ADR-0007). Separate from `recommended`
 * because their premise is the packaging, not the builder contract: to a
 * project that ships ESM only, `import.meta` is the ordinary idiom for path
 * resolution rather than a defect, and a rule that reports correct code is
 * worse than an absent one.
 *
 * Spread alongside `recommended` when you do dual-publish:
 *
 * ```js
 * {
 *   files: ["src/**\/*.ts"],
 *   ...composurecdk.configs.recommended,
 *   rules: {
 *     ...composurecdk.configs.recommended.rules,
 *     ...composurecdk.configs.dualPublishing.rules,
 *   },
 * }
 * ```
 *
 * Membership here is public API on the same terms as `recommended`.
 */
export const dualPublishing: Linter.Config = {
  plugins: { [NAMESPACE]: plugin },
  rules: {
    "composurecdk/no-cjs-incompatible-syntax": "error",
    "composurecdk/no-realm-bound-instanceof": "error",
  },
};
