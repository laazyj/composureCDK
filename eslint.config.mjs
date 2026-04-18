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
    files: ["packages/*/src/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportSpecifier[exported.name=/BuilderProps$/]",
          message:
            "*BuilderProps types are internal to their package — do not re-export them from the package barrel.",
        },
        {
          selector: "ExportAllDeclaration",
          message:
            "Package barrels must use explicit named re-exports so internal types (e.g. *BuilderProps) cannot leak.",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
