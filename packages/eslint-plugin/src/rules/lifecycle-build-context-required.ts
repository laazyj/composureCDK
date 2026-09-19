import type { Rule } from "eslint";
import type { ClassBody, MethodDefinition } from "estree";

/**
 * Flags a `Lifecycle` class whose `build` takes no `context` parameter although
 * the class body uses `Resolvable<…>`.
 *
 * A builder holding a `Resolvable<…>` accepts refs when it is configured, but
 * resolving one needs the build context. With no `context` parameter the
 * resolution receives `undefined` and the ref throws at synth, so the builder
 * offers an API it cannot honour.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/lifecycle-build-context-required.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
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
      ClassBody(node: ClassBody) {
        const build = node.body.find(
          (member): member is MethodDefinition =>
            member.type === "MethodDefinition" &&
            member.key.type === "Identifier" &&
            member.key.name === "build",
        );
        if (!build) return;
        // Lifecycle.build(scope, id, context?) — 3rd param is context.
        if (build.value.params.length >= 3) return;

        if (/\bResolvable\s*</.test(sourceCode.getText(node))) {
          ctx.report({ node: build, messageId: "missingContext" });
        }
      },
    };
  },
};
