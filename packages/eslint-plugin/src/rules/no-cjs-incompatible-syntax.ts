import type { Rule } from "eslint";
import type { AwaitExpression, ForOfStatement, MetaProperty, Node } from "estree";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Flags syntax that cannot be emitted to CommonJS: `import.meta`, top-level
 * `await`, and top-level `for await…of`. All are valid ESM but have no CJS
 * equivalent, so `tsc` (and tshy's CommonJS dialect) errors on them.
 *
 * Only a dual-published package pays this cost, which is why the rule sits in
 * the `dualPublishing` preset rather than `recommended` — in an ESM-only
 * project every one of these is the ordinary idiom. Where it does apply,
 * linting reports in the editor before any build runs, rather than at the end
 * of the per-dialect compile. Every `@composurecdk/*` package is dual-published
 * (ADR-0007), so this repo enables it everywhere.
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
        "`import.meta` cannot be emitted to CommonJS, so it breaks the CommonJS build of a " +
        "dual-published package. Reach for the value another way, or drop this rule if you " +
        "publish ESM only.",
      topLevelAwait:
        "Top-level `await` cannot be emitted to CommonJS, so it breaks the CommonJS build of a " +
        "dual-published package. Move the `await` inside an async function, or drop this rule " +
        "if you publish ESM only.",
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
