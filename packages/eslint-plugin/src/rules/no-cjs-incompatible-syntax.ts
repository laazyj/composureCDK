import type { Rule } from "eslint";
import type { AwaitExpression, ForOfStatement, MetaProperty, Node } from "estree";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Flags syntax in library `src/` that cannot be emitted to CommonJS:
 * `import.meta`, top-level `await`, and top-level `for await…of`. All are
 * valid ESM but have no CJS equivalent, so `tsc` (and tshy's CommonJS
 * dialect) errors on them.
 *
 * Every `@composurecdk/*` package is dual-published (ESM + CJS) — see
 * ADR-0007. Catching these at lint time gives an in-editor error before any
 * build runs, rather than waiting for the per-dialect compile to fail.
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
        "`import.meta` cannot be emitted to CommonJS. Every package is dual-published (ADR-0007) — " +
        "avoid `import.meta` in library `src/`.",
      topLevelAwait:
        "Top-level `await` cannot be emitted to CommonJS. Every package is dual-published (ADR-0007) — " +
        "move the `await` inside an async function.",
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
