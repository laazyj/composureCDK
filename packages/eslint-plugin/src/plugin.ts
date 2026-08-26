import type { ESLint } from "eslint";
import { rules } from "./rules/index.js";

/**
 * The namespace the presets register the plugin under, and the prefix every
 * rule name in them carries. Fixed rather than the consumer's choice: a preset
 * names its rules `composurecdk/<rule>`, so it can only work if the plugin is
 * registered under that same key.
 */
export const NAMESPACE = "composurecdk";

export const meta = { name: "@composurecdk/eslint-plugin" };

/**
 * The plugin object itself, separate from `index.ts` so the presets can embed
 * it in their `plugins` block without importing the entry point that exports
 * them.
 */
export const plugin: ESLint.Plugin = { meta, rules };
