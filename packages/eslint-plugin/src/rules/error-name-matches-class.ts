import type { Rule } from "eslint";
import type { Class, Node } from "estree";
import { unwrapWrappers } from "./lib/imports.js";

/** Whether `this.name = "<className>"` (or a `name = "<className>"` field) sets it. */
function setsName(node: Class, className: string): boolean {
  const isNameKey = (key: Node) => key.type === "Identifier" && key.name === "name";
  const isClassName = (value: Node | null | undefined) => {
    const inner = value && unwrapWrappers(value);
    return inner?.type === "Literal" && inner.value === className;
  };

  return node.body.body.some((member) => {
    if (member.type === "PropertyDefinition") {
      return (
        !member.static && !member.computed && isNameKey(member.key) && isClassName(member.value)
      );
    }
    if (member.type !== "MethodDefinition" || member.kind !== "constructor") return false;
    return member.value.body.body.some((statement) => {
      if (statement.type !== "ExpressionStatement") return false;
      if (statement.expression.type !== "AssignmentExpression") return false;
      const { operator, left, right } = statement.expression;
      return (
        operator === "=" &&
        left.type === "MemberExpression" &&
        left.object.type === "ThisExpression" &&
        !left.computed &&
        isNameKey(left.property) &&
        isClassName(right)
      );
    });
  });
}

/**
 * Flags an `Error` subclass that does not set `name` to its class name, and an
 * exported one whose TSDoc does not tell consumers to catch it by `name`.
 *
 * Every package ships ESM and CommonJS builds, and both can load in one
 * process, so a consumer's `instanceof` can miss an error thrown by the other
 * copy. `name` is the check that works across both, so it has to match the
 * class.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/error-name-matches-class.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "An `Error` subclass sets `name` to its class name, and an exported one says to catch it by `name`.",
    },
    schema: [],
    messages: {
      missingName:
        '`{{className}}` extends `{{superName}}` but does not set `name` to "{{className}}". ' +
        'Add `this.name = "{{className}}";` to its constructor: consumers catch it by `name`, ' +
        "because `instanceof` misses an error thrown by the other module format's copy.",
      missingCatchByNameNote:
        "`{{className}}` is exported, but its TSDoc does not say to catch it by `name`. Add a " +
        "sentence such as: Catch this by `name`, not `instanceof`, because the copy that threw may " +
        "not be the copy the catching module imported.",
    },
  },
  create(ctx) {
    const sourceCode = ctx.sourceCode;

    function check(node: Class & Node): void {
      if (!node.id || node.superClass?.type !== "Identifier") return;
      const superName = node.superClass.name;
      if (superName !== "Error" && !superName.endsWith("Error")) return;
      const className = node.id.name;

      if (!setsName(node, className)) {
        ctx.report({ node: node.id, messageId: "missingName", data: { className, superName } });
      }

      const { parent } = node as Rule.Node;
      if (
        parent?.type !== "ExportNamedDeclaration" &&
        parent?.type !== "ExportDefaultDeclaration"
      ) {
        return;
      }
      const documented = sourceCode
        .getCommentsBefore(parent)
        .some(
          (comment) =>
            comment.type === "Block" &&
            comment.value.startsWith("*") &&
            comment.value.includes("by `name`"),
        );
      if (!documented) {
        ctx.report({ node: node.id, messageId: "missingCatchByNameNote", data: { className } });
      }
    }

    return { ClassDeclaration: check, ClassExpression: check };
  },
};
