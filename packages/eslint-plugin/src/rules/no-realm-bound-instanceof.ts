import type { Rule } from "eslint";
import type { BinaryExpression } from "estree";
import { chainRoot, importSourceOf, isCdkSource, unwrapWrappers } from "./lib/imports.js";

/**
 * Bans `instanceof` against a class reached through an `import`.
 *
 * These packages ship as both ECMAScript and CommonJS modules, and both copies
 * can load in the same process — a consumer importing one while a dependency
 * requires the other. Each copy evaluates its own class objects, so an instance
 * created by one fails `instanceof` against the other's class: the check returns
 * `false` for a value that is plainly of that type.
 *
 * It fails silently, which is what makes it dangerous — a deduplication quietly
 * skipped, a guard quietly bypassed, and no error to trace. Use a `Symbol.for(…)`
 * brand instead, which is shared across copies.
 *
 * A relative import is no safer: it resolves separately in each copy.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/no-realm-bound-instanceof.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban realm-bound `instanceof` against imported classes in dual-published source",
    },
    schema: [],
    messages: {
      cdkClass:
        "`instanceof {{name}}` is realm-bound and silently returns false across the ESM/CJS copy " +
        "boundary (ADR-0007). Identify the construct by its L1 instead: `CfnResource.isCfnResource` " +
        "+ `cfnResourceType === Cfn{{name}}.CFN_RESOURCE_TYPE_NAME` (ADR-0011).",
      ownClass:
        "`instanceof {{name}}` is realm-bound — `{{source}}` can load twice in one process " +
        "(ADR-0007). Brand the class with `Symbol.for(...)` and test that instead, as `isRef` in " +
        "@composurecdk/core does.",
    },
  },
  create(ctx) {
    return {
      BinaryExpression(node: BinaryExpression) {
        if (node.operator !== "instanceof") return;
        const root = chainRoot(node.right);
        if (root === undefined) return;

        const source = importSourceOf(ctx.sourceCode.getScope(node), root.name);
        if (source === undefined) return;

        // Name the class, not the namespace it was reached through:
        // `cdk.aws_s3.Bucket` is "Bucket", and the cdk message interpolates
        // that into `Cfn<name>.CFN_RESOURCE_TYPE_NAME`.
        const target = unwrapWrappers(node.right);
        const name =
          target.type === "MemberExpression" && target.property.type === "Identifier"
            ? target.property.name
            : root.name;

        // Report on the class reference, not the whole expression: the fix
        // replaces the right-hand side, and a narrow squiggle points at it.
        ctx.report({
          node: node.right,
          messageId: isCdkSource(source) ? "cdkClass" : "ownClass",
          data: { name, source },
        });
      },
    };
  },
};
