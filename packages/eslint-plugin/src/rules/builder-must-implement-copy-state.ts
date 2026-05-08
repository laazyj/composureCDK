import type { Rule, SourceCode } from "eslint";
import type { ClassDeclaration, PrivateIdentifier, PropertyDefinition } from "estree";

type IgnoreState = "valid" | "missing-justification" | "absent";

type PrivatePropertyDefinition = PropertyDefinition & { key: PrivateIdentifier };

function readIgnoreMarker(fieldNode: PropertyDefinition, sourceCode: SourceCode): IgnoreState {
  const comments = sourceCode.getCommentsBefore(fieldNode);
  for (const comment of comments) {
    const match = /@copy-state:\s*ignore(.*)$/i.exec(comment.value);
    if (!match) continue;
    const tail = match[1];
    return /--\s*\S/.test(tail) ? "valid" : "missing-justification";
  }
  return "absent";
}

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
export const rule: Rule.RuleModule = {
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
    const builderFactoryNames = new Set<string>();
    const classNodes = new Map<string, ClassDeclaration>();
    const builderClassNames = new Set<string>();
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
          if (spec.imported.type !== "Identifier") continue;
          if (spec.imported.name === "Builder" || spec.imported.name === "taggedBuilder") {
            builderFactoryNames.add(spec.local.name);
          }
        }
      },
      ClassDeclaration(node) {
        classNodes.set(node.id.name, node);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (!builderFactoryNames.has(node.callee.name)) return;
        if (node.arguments.length === 0) return;
        const arg = node.arguments[0];
        if (arg.type === "Identifier") builderClassNames.add(arg.name);
      },
      "Program:exit"() {
        for (const className of builderClassNames) {
          const classNode = classNodes.get(className);
          if (!classNode) continue;

          const privateFields: PrivatePropertyDefinition[] = [];
          let hasCopyStateHook = false;
          for (const member of classNode.body.body) {
            if (member.type === "PropertyDefinition" && member.key.type === "PrivateIdentifier") {
              privateFields.push(member as PrivatePropertyDefinition);
            } else if (
              member.type === "MethodDefinition" &&
              member.computed &&
              member.key.type === "Identifier" &&
              member.key.name === "COPY_STATE"
            ) {
              hasCopyStateHook = true;
            }
          }

          const fieldsNeedingHook: string[] = [];
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
              node: classNode.id,
              messageId: "missingHook",
              data: { className, fields: fieldsNeedingHook.join(", ") },
            });
          }
        }
      },
    };
  },
};
