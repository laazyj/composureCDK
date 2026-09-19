import type { Rule } from "eslint";
import type { CallExpression, Node } from "estree";

/**
 * Flags a two-argument `builder.build(scope, id)` call, which gives the
 * sub-builder no context to resolve refs against.
 *
 * A builder that delegates must pass its context on. When it does not, the
 * sub-builder resolves against an empty context, and any ref the caller supplied
 * through a `configure` callback fails at synth with "component not found in
 * context".
 *
 * This is the call-site counterpart to `lifecycle-build-context-required`, which
 * checks the declaration. Accepting the parameter is not enough — the common
 * failure is a builder that takes `context` and then drops it on the way down.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/lifecycle-build-must-forward-context.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "A Lifecycle build() call must forward the build context to sub-builders",
    },
    schema: [],
    messages: {
      missingContext:
        "`build(scope, id)` drops the build context. A sub-builder resolves refs against `{}` " +
        "without it, so a `ref()` passed through a `configure` callback throws " +
        '"component not found in context". Pass the context as the third argument — ' +
        "threading it through any helper function in between. If this is a deliberate root " +
        "build with no context to forward, disable this rule on the line and say why.",
    },
  },
  create(ctx) {
    return {
      CallExpression(node: CallExpression) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "build") return;

        // Exactly (scope, id) — see the "Why exactly two arguments" note above.
        if (node.arguments.length !== 2) return;
        if (node.arguments.some((arg) => arg.type === "SpreadElement")) return;

        ctx.report({ node: node as unknown as Node, messageId: "missingContext" });
      },
    };
  },
};
