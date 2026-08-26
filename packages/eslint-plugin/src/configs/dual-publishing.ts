import type { Linter } from "eslint";
import { preset } from "./preset.js";

/**
 * The rules whose premise is the format the project itself publishes: they bind
 * a package built as dual ESM/CJS, as this library is (ADR-0007), and nothing
 * else. Separate from `recommended` because to a project shipping ESM only,
 * `import.meta` is the ordinary idiom for path resolution rather than a defect.
 *
 * Add it as a second config entry alongside `recommended` — flat config
 * composes by array, so neither needs merging into the other:
 *
 * ```js
 * export default [
 *   { files: ["src/**\/*.ts"], ...composurecdk.configs.recommended },
 *   { files: ["src/**\/*.ts"], ...composurecdk.configs.dualPublishing },
 * ];
 * ```
 *
 * Membership here is public API on the same terms as `recommended`.
 */
export const dualPublishing: Linter.Config = preset(["no-cjs-incompatible-syntax"]);
