import type { Linter } from "eslint";
import { NAMESPACE, plugin } from "../plugin.js";

/**
 * Builds a preset from bare rule names: prefixes each with {@link NAMESPACE},
 * sets it to `error`, and registers the plugin under that same namespace so a
 * spread config needs no `plugins` block of its own.
 *
 * Going through here is what makes `NAMESPACE` authoritative — a preset that
 * spelled `"composurecdk/…"` out per key would keep working if the constant
 * changed, and the plugin would then be registered under a name none of its
 * rules referenced.
 */
export function preset(ruleNames: readonly string[], extra?: Linter.RulesRecord): Linter.Config {
  return {
    plugins: { [NAMESPACE]: plugin },
    rules: {
      ...Object.fromEntries(ruleNames.map((name) => [`${NAMESPACE}/${name}`, "error"])),
      ...extra,
    },
  };
}

/**
 * Merges presets left to right into one config — later `rules` win, and any
 * other key a preset carries (`languageOptions`, `settings`) survives, which a
 * hand-merge of `.rules` alone would silently drop.
 */
export function merge(...configs: Linter.Config[]): Linter.Config {
  return configs.reduce<Linter.Config>(
    (acc, config) => ({ ...acc, ...config, rules: { ...acc.rules, ...config.rules } }),
    {},
  );
}
