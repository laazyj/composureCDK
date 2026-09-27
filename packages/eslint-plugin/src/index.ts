import type { ESLint, Linter } from "eslint";
import {
  dualPublishingRules,
  internalRules,
  libraryAuthorRules,
  recommendedRules,
} from "./configs/presets.js";
import { rules } from "./rules/index.js";

/**
 * The plugin object, built before `configs` so every preset can register *this*
 * object under `plugins`.
 *
 * The identity matters. ESLint rejects a flat config whose entries register two
 * different objects under one plugin name, so a consumer extending two presets
 * at once — or extending one and writing `plugins: { composurecdk }` themselves
 * — must be handing ESLint the same reference each time. `Object.assign` below
 * attaches `configs` to this object rather than producing a second one.
 */
const plugin: ESLint.Plugin = {
  // Names the plugin in `--print-config` output and the flat config inspector.
  meta: { name: "@composurecdk/eslint-plugin" },
  rules,
};

/**
 * Self-contained flat config entries — each registers the plugin, so a consumer
 * needs no `plugins` entry of their own, and they compose:
 *
 * ```js
 * import composurecdk from "@composurecdk/eslint-plugin";
 * export default [
 *   {
 *     files: ["src/**\/*.ts"],
 *     extends: [composurecdk.configs.recommended, composurecdk.configs.dualPublishing],
 *   },
 * ];
 * ```
 *
 * None declares `files`: the rules target library source, but only the consumer
 * knows where theirs lives. See `./configs/presets.ts` for which rules each
 * holds and why.
 */
export const configs = {
  recommended: {
    name: "composurecdk/recommended",
    plugins: { composurecdk: plugin },
    rules: recommendedRules,
  },
  libraryAuthor: {
    name: "composurecdk/library-author",
    plugins: { composurecdk: plugin },
    rules: libraryAuthorRules,
  },
  dualPublishing: {
    name: "composurecdk/dual-publishing",
    plugins: { composurecdk: plugin },
    rules: dualPublishingRules,
  },
  internal: {
    name: "composurecdk/internal",
    plugins: { composurecdk: plugin },
    rules: internalRules,
  },
} satisfies Record<string, Linter.Config>;

export { rules };

export default Object.assign(plugin, { configs });
