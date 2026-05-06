// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";

/**
 * Flags uses of `Builder()` or `IBuilder<…>` imported from `@composurecdk/core`
 * in library builder files. Library builders should opt into the shared tagging
 * surface via `taggedBuilder` / `ITaggedBuilder` from `@composurecdk/cloudformation`.
 */
const builderTaggingRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Library builders must use `taggedBuilder` / `ITaggedBuilder` from `@composurecdk/cloudformation` " +
        "unless the wrapped CFN resource has no Tags property.",
    },
    schema: [],
    messages: {
      restrictedCall:
        "Use `taggedBuilder` from `@composurecdk/cloudformation` instead of `Builder` from `@composurecdk/core`. " +
        "If the wrapped CFN resource has no Tags property (Route53 records, IAM ManagedPolicy, " +
        "SNS Subscription, AWS Budgets), disable this rule on the offending line with a directive " +
        "naming the resource: `// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::… has no Tags property`.",
      restrictedType:
        "Use `ITaggedBuilder` from `@composurecdk/cloudformation` instead of `IBuilder` from `@composurecdk/core`. " +
        "If the wrapped CFN resource has no Tags property (Route53 records, IAM ManagedPolicy, " +
        "SNS Subscription, AWS Budgets), disable this rule on the offending line with a directive " +
        "naming the resource: `// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::… has no Tags property`.",
    },
  },
  create(ctx) {
    const localBuilderNames = new Set();
    const localIBuilderNames = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@composurecdk/core") return;
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue;
          if (spec.imported.name === "Builder") localBuilderNames.add(spec.local.name);
          if (spec.imported.name === "IBuilder") localIBuilderNames.add(spec.local.name);
        }
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && localBuilderNames.has(node.callee.name)) {
          ctx.report({ node: node.callee, messageId: "restrictedCall" });
        }
      },
      TSTypeReference(node) {
        if (node.typeName.type === "Identifier" && localIBuilderNames.has(node.typeName.name)) {
          ctx.report({ node: node.typeName, messageId: "restrictedType" });
        }
      },
    };
  },
};

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
        // Lifecycle.build(scope, id, context?) — 3rd param is context.
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
          "builder-must-be-tagged": builderTaggingRule,
        },
      },
    },
    rules: {
      "composurecdk/lifecycle-build-context-required": "error",
      "composurecdk/builder-must-be-tagged": "error",
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
