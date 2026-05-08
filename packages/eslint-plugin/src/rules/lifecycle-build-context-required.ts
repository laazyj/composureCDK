import type { Rule } from "eslint";
import type { ClassBody, MethodDefinition } from "estree";

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
