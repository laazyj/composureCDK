import * as tsParser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin, { configs, rules } from "../../src/index.js";

const PREFIX = "composurecdk/";

describe("configs.recommended", () => {
  it("registers the plugin, so extending it needs no `plugins` entry", () => {
    expect(configs.recommended.plugins?.composurecdk).toBeDefined();
  });

  it("registers the same object consumers import as the default export", () => {
    // Not incidental: ESLint rejects a flat config whose entries register two
    // different objects under one plugin name, so a consumer who both extends
    // the preset and writes `plugins: { composurecdk }` would otherwise get
    // "Cannot redefine plugin".
    expect(configs.recommended.plugins?.composurecdk).toBe(plugin);
  });

  it("enables every rule the plugin exports, and no rule it does not", () => {
    const configured = Object.keys(configs.recommended.rules ?? {})
      .filter((id) => id.startsWith(PREFIX))
      .map((id) => id.slice(PREFIX.length));

    expect(configured.sort()).toEqual(Object.keys(rules).sort());
  });

  it("resolves its rule ids when ESLint runs it as a flat config entry", async () => {
    // The regression this guards: while the preset carried bare `rules` and no
    // `plugins`, extending it directly left `composurecdk/*` pointing at an
    // unregistered plugin, and ESLint threw rather than linting.
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        { files: ["**/*.ts"], languageOptions: { parser: tsParser } },
        configs.recommended,
      ],
    });

    const [result] = await eslint.lintText("const url = import.meta.url;\n", {
      filePath: "sample.ts",
    });

    // Proves the plugin resolved *and* its rules actually ran.
    expect(result.messages.map((m) => m.ruleId)).toContain(`${PREFIX}no-cjs-incompatible-syntax`);
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  });

  it("can be combined with a consumer's own `plugins` entry", async () => {
    // The README tells consumers they may mix the two forms to take a subset of
    // rules. That only holds because both register the same object — ESLint
    // rejects a second, different one with "Cannot redefine plugin".
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        { files: ["**/*.ts"], languageOptions: { parser: tsParser } },
        configs.recommended,
        { files: ["**/*.ts"], plugins: { composurecdk: plugin }, rules: {} },
      ],
    });

    const [result] = await eslint.lintText("const url = import.meta.url;\n", {
      filePath: "sample.ts",
    });

    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  });

  it("declares no `files`, leaving scoping to the consumer", () => {
    // The rules target library source, but only the consumer knows where theirs
    // lives — see the preset's doc comment.
    expect(configs.recommended.files).toBeUndefined();
  });
});
