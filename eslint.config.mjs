// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default defineConfig(
  { ignores: ["**/dist/", "**/node_modules/", "**/cdk.out/"] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "scripts/*.mjs"],
        },
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["scripts/*.mjs"],
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
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "PropertyDefinition[accessibility='private']",
          message:
            "Use ECMAScript private fields (#field) instead of the TypeScript `private` modifier. TS `private` members appear in `keyof T` and leak into emitted .d.ts files via mapped types (builder types), producing TS4094 errors downstream.",
        },
        {
          selector: "MethodDefinition[accessibility='private'][kind!='constructor']",
          message:
            "Use ECMAScript private methods (#method()) instead of the TypeScript `private` modifier. Private constructors are the only permitted use of `private` since `#constructor` is not valid syntax.",
        },
        {
          selector: "TSParameterProperty[accessibility='private']",
          message:
            "Parameter properties cannot be ECMAScript private. Declare the field with `readonly #field` and assign it in the constructor body.",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
