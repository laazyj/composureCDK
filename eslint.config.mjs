// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

/**
 * Flags Lifecycle-implementing classes whose `build` method does not accept a
 * `context` parameter but whose class body uses `Resolvable<…>`. Such builders
 * accept refs at configuration time but have no way to resolve them at build
 * time — calls to `resolve(value, context)` would receive `undefined` and the
 * ref would throw "cannot be resolved".
 *
 * The rule keys on `Resolvable` (a name unique to this codebase) to avoid the
 * false positives that keying on `resolve(` would produce (Promise.resolve, etc.).
 */
const lifecycleContextParamRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Lifecycle.build() must accept context when the builder uses Resolvable<…>",
    },
    schema: [],
    messages: {
      missingContext:
        "`build()` is missing the `context` parameter, but this class uses `Resolvable<…>`. " +
        "Refs need context to resolve — add `context?: Record<string, object>` (or a typed dependency record) and pass it to `resolve(value, context)`.",
    },
  },
  create(ctx) {
    const sourceCode = ctx.sourceCode;
    return {
      ClassBody(node) {
        const build = node.body.find(
          (member) =>
            member.type === "MethodDefinition" &&
            member.key.type === "Identifier" &&
            member.key.name === "build",
        );
        if (!build) return;
        if (build.value.params.length >= 3) return;

        const classText = sourceCode.getText(node);
        if (/\bResolvable\s*</.test(classText)) {
          ctx.report({ node: build, messageId: "missingContext" });
        }
      },
    };
  },
};

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
    plugins: {
      composurecdk: {
        rules: {
          "lifecycle-build-context-required": lifecycleContextParamRule,
        },
      },
    },
    rules: {
      "composurecdk/lifecycle-build-context-required": "error",
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
