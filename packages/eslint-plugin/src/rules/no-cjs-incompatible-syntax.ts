import type { Rule } from "eslint";
import type { AwaitExpression, ForOfStatement, MetaProperty, Node } from "estree";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Flags syntax with no CommonJS equivalent: `import.meta`, top-level `await` and
 * top-level `for await…of`.
 *
 * These packages are published as both ECMAScript and CommonJS modules from one
 * source. All three constructs are valid ESM that the CommonJS compile cannot
 * emit, so each one breaks half the build. Reporting them as you type beats
 * discovering it when the second dialect compiles.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/no-cjs-incompatible-syntax.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban ESM-only syntax (import.meta, top-level await) that cannot emit to CommonJS",
    },
    schema: [],
    messages: {
      importMeta:
        "`import.meta` has no CommonJS equivalent, so it breaks the CommonJS half of a " +
        "dual-published build. Take the value from a parameter or a caller instead.",
      topLevelAwait:
        "Top-level `await` has no CommonJS equivalent, so it breaks the CommonJS half of a " +
        "dual-published build. Move the `await` inside an async function.",
    },
  },
  create(ctx) {
    const isTopLevel = (node: Node): boolean =>
      !ctx.sourceCode.getAncestors(node).some((ancestor) => FUNCTION_TYPES.has(ancestor.type));

    return {
      MetaProperty(node: MetaProperty) {
        if (node.meta.name === "import" && node.property.name === "meta") {
          ctx.report({ node, messageId: "importMeta" });
        }
      },
      AwaitExpression(node: AwaitExpression) {
        if (isTopLevel(node)) {
          ctx.report({ node, messageId: "topLevelAwait" });
        }
      },
      "ForOfStatement[await=true]"(node: ForOfStatement) {
        if (isTopLevel(node)) {
          ctx.report({ node, messageId: "topLevelAwait" });
        }
      },
    };
  },
};
