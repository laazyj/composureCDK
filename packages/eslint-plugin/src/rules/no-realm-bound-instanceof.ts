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
 * A relative import is no safer by default: it resolves separately in each copy.
 * A package nothing can install twice may say so with
 * `assumeNeverInstalledAsADependency`, which treats its own modules as
 * same-realm while still flagging dependencies. An application is the archetype;
 * being private is not enough, since a private package can still be a
 * dependency.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/no-realm-bound-instanceof.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban realm-bound `instanceof` against imported classes",
    },
    schema: [
      {
        type: "object",
        properties: {
          assumeNeverInstalledAsADependency: {
            type: "boolean",
            description:
              "Exempt this package's own relative imports, on the basis that nothing can " +
              "install it twice. An application's claim to make; a library must not, since a " +
              "consumer can install two versions of it side by side.",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      cdkClass:
        "`instanceof {{name}}` is realm-bound: it returns false for a value created by another " +
        "copy of `aws-cdk-lib`. Identify the construct by its L1 instead — " +
        "`CfnResource.isCfnResource(x) && x.cfnResourceType === Cfn{{name}}.CFN_RESOURCE_TYPE_NAME`.",
      ownClass:
        "`instanceof {{name}}` is realm-bound: `{{source}}` resolves separately in each copy of " +
        "this package, so the check returns false for a value that is plainly of that type. " +
        "Brand the class with `Symbol.for(...)` and test for that brand instead.",
      dependencyClass:
        "`instanceof {{name}}` is realm-bound: `{{source}}` can load twice in one process, so the " +
        "check returns false for a value that is plainly of that type. Prefer a type guard the " +
        "package provides, or test a distinguishing property rather than identity. If the class " +
        "is one you own, brand it with `Symbol.for(...)`.",
    },
  },
  create(ctx) {
    const { assumeNeverInstalledAsADependency = false } = (ctx.options[0] ?? {}) as {
      assumeNeverInstalledAsADependency?: boolean;
    };

    return {
      BinaryExpression(node: BinaryExpression) {
        if (node.operator !== "instanceof") return;
        const root = chainRoot(node.right);
        if (root === undefined) return;

        const source = importSourceOf(ctx.sourceCode.getScope(node), root.name);
        if (source === undefined) return;
        // A relative specifier resolves inside this package, so it duplicates
        // only if the package itself does. Deliberately not `#` subpaths: the
        // `imports` field can map one to an external package.
        if (assumeNeverInstalledAsADependency && source.startsWith(".")) return;

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
        // The specifier says whether the reader can brand the class: a relative
        // import is their own module, anything else is someone else's package.
        const messageId = isCdkSource(source)
          ? "cdkClass"
          : source.startsWith(".")
            ? "ownClass"
            : "dependencyClass";

        ctx.report({ node: node.right, messageId, data: { name, source } });
      },
    };
  },
};
