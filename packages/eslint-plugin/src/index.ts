import type { ESLint, Linter } from "eslint";
import { recommendedRules } from "./configs/recommended.js";
import { rules } from "./rules/index.js";

/**
 * The plugin object, built before `configs` so `configs.recommended` can
 * register *this* object under `plugins`.
 *
 * The identity matters. ESLint rejects a flat config whose entries register two
 * different objects under one plugin name, so a consumer who both extends the
 * preset and writes `plugins: { composurecdk }` must be handing ESLint the same
 * reference twice. `Object.assign` below attaches `configs` to this object
 * rather than producing a second one.
 */
const plugin: ESLint.Plugin = {
  // Names the plugin in `--print-config` output and the flat config inspector.
  meta: { name: "@composurecdk/eslint-plugin" },
  rules,
};

/**
 * Flat config entry enabling every rule at its intended severity. Self-contained
 * — it registers the plugin, so a consumer needs no `plugins` entry of their own:
 *
 * ```js
 * import composurecdk from "@composurecdk/eslint-plugin";
 * export default [
 *   { files: ["src/**\/*.ts"], extends: [composurecdk.configs.recommended] },
 * ];
 * ```
 *
 * It deliberately declares no `files`. The rules are written for library source,
 * but only the consumer knows where theirs lives, so scoping is theirs to do —
 * applying the preset unscoped will flag test and fixture code.
 */
const recommended: Linter.Config = {
  name: "composurecdk/recommended",
  plugins: { composurecdk: plugin },
  rules: recommendedRules,
};

export const configs = { recommended };
export { rules };

export default Object.assign(plugin, { configs });
