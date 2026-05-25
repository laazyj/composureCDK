// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import composurecdk from "@composurecdk/eslint-plugin";

export default defineConfig(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/cdk.out/",
      // Hand-written ESM/CJS consumption fixtures — each is deliberately a
      // specific module system and is exercised by spawning `node`, not linted.
      "packages/module-compat/test/fixtures/",
      // cdk-floor harness fixture — imports rig-only deps and runs inside a
      // throwaway project (scripts/cdk-floor-test.mjs), not linted here.
      "scripts/cdk-floor/",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.mjs",
            "scripts/*.mjs",
            "packages/examples/test/smoke/*.mjs",
          ],
        },
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["scripts/*.mjs", "packages/examples/test/smoke/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: { composurecdk },
    rules: composurecdk.configs.recommended.rules,
  },
  {
    // The tagged-builder wrapper IS the implementation of the tagged-builder
    // surface — by definition it must reach for `Builder` / `IBuilder` from
    // `@composurecdk/core`. Disable the rule at the file level rather than
    // peppering disable comments through the body.
    files: ["packages/cloudformation/src/tagged-builder.ts"],
    rules: {
      "composurecdk/builder-must-be-tagged": "off",
    },
  },
  {
    files: ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"],
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
    },
  },
  eslintConfigPrettier,
);
