import * as tsParser from "@typescript-eslint/parser";
import { ESLint, type Linter } from "eslint";
import { describe, expect, it } from "vitest";
import plugin, { configs, rules } from "../../src/index.js";

const PREFIX = "composurecdk/";
// Widened to `Linter.Config`: the literals provably carry no `files`, but the
// assertions below are about the shipped objects, not their inferred types.
const PRESETS: [string, Linter.Config][] = Object.entries(configs);

/** The `composurecdk/*` rule names a preset enables, without the prefix. */
function ruleNamesIn(preset: Linter.Config): string[] {
  return Object.keys(preset.rules ?? {})
    .filter((id) => id.startsWith(PREFIX))
    .map((id) => id.slice(PREFIX.length));
}

describe.each(PRESETS)("configs.%s", (name, preset) => {
  it("registers the plugin, so extending it needs no `plugins` entry", () => {
    expect(preset.plugins?.composurecdk).toBeDefined();
  });

  it("registers the same object consumers import as the default export", () => {
    // ESLint rejects a config whose entries register two different objects under
    // one plugin name, so this is what lets the presets be combined.
    expect(preset.plugins?.composurecdk).toBe(plugin);
  });

  it("declares no `files`, leaving scoping to the consumer", () => {
    expect(preset.files).toBeUndefined();
  });

  it("enables only rules the plugin exports", () => {
    const unknown = ruleNamesIn(preset).filter((rule) => !(rule in rules));

    expect(unknown).toEqual([]);
  });
});

describe("the presets as a set", () => {
  it("are named, so they are identifiable in --print-config output", () => {
    expect(PRESETS.map(([, preset]) => preset.name)).toEqual([
      "composurecdk/recommended",
      "composurecdk/library-author",
      "composurecdk/dual-publishing",
      "composurecdk/internal",
    ]);
  });

  it("place no rule in two presets", () => {
    // A rule in two tiers makes its severity depend on extend order, silently.
    const placements = PRESETS.flatMap(([, preset]) => ruleNamesIn(preset));

    expect(placements.filter((r, i) => placements.indexOf(r) !== i)).toEqual([]);
  });

  it("leave only the deliberately unassigned rules out of every preset", () => {
    // A new rule ships registered but in no preset, joining one at the next
    // major (ADR-0019). Listing them here is what separates "waiting for the
    // major" from "forgotten", which is otherwise invisible.
    const AWAITING_A_MAJOR: string[] = [];
    const placed = new Set(PRESETS.flatMap(([, preset]) => ruleNamesIn(preset)));

    const unplaced = Object.keys(rules).filter((name) => !placed.has(name));

    expect(unplaced.sort()).toEqual([...AWAITING_A_MAJOR].sort());
  });

  it("can all be extended together", async () => {
    // The combination this repo's own config uses. If the presets registered
    // different plugin objects, ESLint would reject this with "Cannot redefine
    // plugin" rather than lint.
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        { files: ["**/*.ts"], languageOptions: { parser: tsParser } },
        ...PRESETS.map(([, preset]) => preset),
        // The README tells consumers they may add their own entry to pick rules
        // individually. Four registrations of one plugin name, and ESLint accepts
        // them only because every one is the same object.
        { files: ["**/*.ts"], plugins: { composurecdk: plugin }, rules: {} },
      ],
    });

    const [result] = await eslint.lintText("const url = import.meta.url;\n", {
      filePath: "sample.ts",
    });

    expect(result.messages.map((m) => m.ruleId)).toContain(`${PREFIX}no-cjs-incompatible-syntax`);
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  });

  it("keeps the dual-publishing rules out of recommended", async () => {
    // The point of the split: a single-format consumer extending `recommended`
    // alone must not be told off for `import.meta`, which is legal for them.
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

    expect(result.messages).toEqual([]);
  });

  it("still reports a recommended rule when extended alone", async () => {
    // The complement of the test above: `recommended` going quiet for everything
    // would satisfy it just as well, so prove one of its own rules fires.
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        { files: ["**/*.ts"], languageOptions: { parser: tsParser } },
        configs.recommended,
      ],
    });

    const [result] = await eslint.lintText(
      'import { Bucket } from "aws-cdk-lib/aws-s3";\nexport const f = (v: unknown) => v instanceof Bucket;\n',
      { filePath: "sample.ts" },
    );

    expect(result.messages.map((m) => m.ruleId)).toContain(`${PREFIX}no-realm-bound-instanceof`);
  });
});
