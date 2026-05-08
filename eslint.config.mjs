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
const taggedSuffix =
  "If the wrapped CFN resource has no Tags property (Route53 records, IAM ManagedPolicy, " +
  "SNS Subscription, AWS Budgets), disable this rule on the offending line with a directive " +
  "naming the resource: `// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::… has no Tags property`.";

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
        taggedSuffix,
      restrictedType:
        "Use `ITaggedBuilder` from `@composurecdk/cloudformation` instead of `IBuilder` from `@composurecdk/core`. " +
        taggedSuffix,
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

/**
 * Flags builder classes (passed as the first arg to `Builder()` or
 * `taggedBuilder()`) that hold private state without a `[COPY_STATE]` hook.
 * Per ADR-0005, `.copy()` shallow-clones `props`; non-`props` state needs
 * `[COPY_STATE]` to carry it onto the cloned instance, otherwise `.copy()`
 * silently drops it and breaks both variant authoring and strategy hand-off.
 *
 * The rule checks for *existence* of the hook, not correctness — a hook
 * that copies three of five fields will pass. The companion test helper
 * `assertCopyPreservesState` (`@composurecdk/core/testing`) closes the
 * correctness gap on the test side.
 *
 * **Per-field opt-out.** Annotate a field with a leading
 * `// @copy-state: ignore -- justification` comment to exempt it (e.g.
 * for cache-shaped state that's regenerated per build). The justification
 * after `--` is required.
 */
const builderCopyStateRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Builder classes with private fields must implement `[COPY_STATE]` " +
        "(or annotate fields with `// @copy-state: ignore -- reason`). See ADR-0005.",
    },
    schema: [],
    messages: {
      missingHook:
        "Builder class `{{className}}` has private field(s) {{fields}} but no `[COPY_STATE]` hook. " +
        "Without the hook, `.copy()` silently drops these fields. " +
        "Implement `[COPY_STATE](target) { … }` (see ADR-0005) or annotate each field with " +
        "`// @copy-state: ignore -- reason`.",
      ignoreMarkerNeedsJustification:
        "`@copy-state: ignore` on field `{{field}}` must include a justification after `--` " +
        "(e.g. `// @copy-state: ignore -- regenerated per build`). The reason survives refactors " +
        "and shows up in code review.",
    },
  },
  create(ctx) {
    const sourceCode = ctx.sourceCode;
    const builderFactoryNames = new Set();
    const classNodes = new Map();
    const builderClassNames = new Set();
    return {
      ImportDeclaration(node) {
        if (
          node.source.value !== "@composurecdk/core" &&
          node.source.value !== "@composurecdk/cloudformation"
        ) {
          return;
        }
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue;
          if (spec.imported.name === "Builder" || spec.imported.name === "taggedBuilder") {
            builderFactoryNames.add(spec.local.name);
          }
        }
      },
      ClassDeclaration(node) {
        if (node.id) classNodes.set(node.id.name, node);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (!builderFactoryNames.has(node.callee.name)) return;
        const arg = node.arguments[0];
        if (arg && arg.type === "Identifier") builderClassNames.add(arg.name);
      },
      "Program:exit"() {
        for (const className of builderClassNames) {
          const classNode = classNodes.get(className);
          if (!classNode) continue;

          const privateFields = [];
          let hasCopyStateHook = false;
          for (const member of classNode.body.body) {
            if (member.type === "PropertyDefinition" && member.key.type === "PrivateIdentifier") {
              privateFields.push(member);
            } else if (
              member.type === "MethodDefinition" &&
              member.computed === true &&
              member.key.type === "Identifier" &&
              member.key.name === "COPY_STATE"
            ) {
              hasCopyStateHook = true;
            }
          }

          const fieldsNeedingHook = [];
          for (const field of privateFields) {
            const ignoreState = readIgnoreMarker(field, sourceCode);
            if (ignoreState === "valid") continue;
            if (ignoreState === "missing-justification") {
              ctx.report({
                node: field,
                messageId: "ignoreMarkerNeedsJustification",
                data: { field: `#${field.key.name}` },
              });
              continue;
            }
            fieldsNeedingHook.push(`#${field.key.name}`);
          }

          if (!hasCopyStateHook && fieldsNeedingHook.length > 0) {
            ctx.report({
              node: classNode.id ?? classNode,
              messageId: "missingHook",
              data: { className, fields: fieldsNeedingHook.join(", ") },
            });
          }
        }
      },
    };
  },
};

function readIgnoreMarker(fieldNode, sourceCode) {
  const comments = sourceCode.getCommentsBefore(fieldNode);
  for (const comment of comments) {
    const match = /@copy-state:\s*ignore(.*)$/i.exec(comment.value);
    if (!match) continue;
    const tail = match[1] ?? "";
    return /--\s*\S/.test(tail) ? "valid" : "missing-justification";
  }
  return "absent";
}

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
          "builder-must-implement-copy-state": builderCopyStateRule,
        },
      },
    },
    rules: {
      "composurecdk/lifecycle-build-context-required": "error",
      "composurecdk/builder-must-be-tagged": "error",
      "composurecdk/builder-must-implement-copy-state": "error",
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
