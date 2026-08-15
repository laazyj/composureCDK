import type { Rule } from "eslint";
import type { CallExpression, Node } from "estree";

/**
 * Flags `builder.build(scope, id)` calls in library source that omit the third
 * `context` argument.
 *
 * This is the call-site counterpart to `lifecycle-build-context-required`,
 * which checks the *declaration* — that a builder holding a `Resolvable<…>`
 * accepts `context`. Having the parameter is not enough: a builder that
 * delegates to a sub-builder must also pass its context on. When it does not,
 * the sub-builder resolves refs against `{}` and any `ref()` a caller supplied
 * through a `configure` callback dies with "component not found in context".
 *
 * The declaration rule cannot see this. It keys on `Resolvable<` appearing in
 * the builder's own class body, and in every real occurrence the resolvable
 * lived one delegation away — in the *sub-builder's* props — while the
 * offending call sat in a free helper function (`resolveAccessLogs`,
 * `resolveFlowLogs`, …), often in another file. Checking the call site
 * directly is what catches those, and it catches both failure modes at once:
 * to satisfy the rule at the leaf you must thread `context` into the helper,
 * which in turn forces the parameter onto the parent's `build`.
 *
 * ## Why exactly two arguments
 *
 * `Lifecycle.build(scope, id, context?)` is always called with at least
 * `scope` and `id`, so a two-argument `.build(…)` call is the signature of the
 * bug. Restricting to exactly two — rather than "fewer than three" — keeps the
 * rule off unrelated `build()` methods that happen to share the name, notably
 * `StatementBuilder.build()` in `@composurecdk/iam`, which takes none. A
 * spread call such as `target.build(...args)` is one argument and is likewise
 * skipped; that is the generic forwarding wrapper in `tagged-builder.ts`,
 * which passes context through by construction.
 *
 * The rule is deliberately syntactic, matching every other rule in this
 * plugin. Type information would let it assert the receiver really is a
 * `Lifecycle`, but the residual false-positive set is small and specific
 * (root-level standalone builds, see below), so the added cost is not yet
 * worth paying.
 *
 * ## Deliberate two-argument builds
 *
 * A root-level build genuinely has no context to forward — nothing composed it.
 * Those are legitimate and are silenced with an explicit disable naming the
 * reason, so the exception stays visible in review:
 *
 * ```ts
 * // eslint-disable-next-line composurecdk/lifecycle-build-must-forward-context -- root build: the strategy callback receives only (scope, id)
 * stackBuilder.build(scope, id);
 * ```
 *
 * Application entry points (`packages/examples/src`) build at the root as a
 * matter of course, so the rule is not applied to them by the root config.
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
