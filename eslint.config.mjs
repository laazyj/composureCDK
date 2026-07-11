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
      "**/coverage/",
      // Hand-written ESM/CJS consumption fixtures — each is deliberately a
      // specific module system and is exercised by spawning `node`, not linted.
      "packages/module-compat/test/fixtures/",
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
            "scripts/*.cjs",
            "scripts/cdk-floor/*.mjs",
            "packages/examples/test/smoke/*.mjs",
            "vitest.config.base.ts",
            "packages/*/vitest.config.ts",
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
    files: ["scripts/*.mjs", "scripts/cdk-floor/*.mjs", "packages/examples/test/smoke/*.mjs"],
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
    files: ["scripts/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        console: "readonly",
      },
    },
    // CommonJS is required here: nx loads non-".ts" changelog renderers with
    // require(), which cannot import an ESM module in this "type": "module" repo.
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["vitest.config.base.ts", "packages/*/vitest.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: { composurecdk },
    rules: composurecdk.configs.recommended.rules,
  },
  {
    // @composurecdk/core is the root of the dependency graph. It stays
    // CDK-version-agnostic — depending only on `constructs` (peer) and
    // `@dagrejs/graphlib` — and must never import a sibling @composurecdk
    // package or a CDK construct library. See docs/architecture.md. This
    // encodes as lint what was previously an unwritten convention; the
    // graph-wide version (phantom deps, cycles, deep imports) is a planned
    // follow-up via @nx/enforce-module-boundaries.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "aws-cdk-lib",
                "aws-cdk-lib/*",
                "aws-cdk-lib/**",
                "@aws-cdk/*",
                "@aws-cdk/**",
              ],
              message:
                "@composurecdk/core must not depend on aws-cdk-lib or any @aws-cdk/* construct library — it stays CDK-version-agnostic and depends only on `constructs`. See docs/architecture.md.",
            },
            {
              group: ["@composurecdk/*", "@composurecdk/**"],
              message:
                "@composurecdk/core is the root of the dependency graph and must not import from any other @composurecdk package.",
            },
          ],
        },
      ],
    },
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
