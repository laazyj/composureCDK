import type { Rule } from "eslint";
import type { Node } from "estree";

const taggedSuffix =
  "If the wrapped CFN resource has no Tags property (Route53 records, IAM ManagedPolicy, " +
  "SNS Subscription, AWS Budgets), disable this rule on the offending line with a directive " +
  "naming the resource: `// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::… has no Tags property`.";

interface TSTypeReferenceLike {
  type: "TSTypeReference";
  typeName: { type: string; name?: string } & Node;
}

/**
 * Flags uses of `Builder()` or `IBuilder<…>` imported from `@composurecdk/core`
 * in library builder files. Library builders should opt into the shared tagging
 * surface via `taggedBuilder` / `ITaggedBuilder` from `@composurecdk/cloudformation`.
 */
export const rule: Rule.RuleModule = {
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
    const localBuilderNames = new Set<string>();
    const localIBuilderNames = new Set<string>();
    const listener: Rule.RuleListener = {
      ImportDeclaration(node) {
        if (node.source.value !== "@composurecdk/core") return;
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue;
          if (spec.imported.type !== "Identifier") continue;
          if (spec.imported.name === "Builder") localBuilderNames.add(spec.local.name);
          if (spec.imported.name === "IBuilder") localIBuilderNames.add(spec.local.name);
        }
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && localBuilderNames.has(node.callee.name)) {
          ctx.report({ node: node.callee, messageId: "restrictedCall" });
        }
      },
    };
    listener.TSTypeReference = (node: Node) => {
      const ref = node as unknown as TSTypeReferenceLike;
      const name = ref.typeName.name;
      if (
        ref.typeName.type === "Identifier" &&
        name !== undefined &&
        localIBuilderNames.has(name)
      ) {
        ctx.report({ node: ref.typeName, messageId: "restrictedType" });
      }
    };
    return listener;
  },
};
