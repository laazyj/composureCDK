import type { Rule } from "eslint";
import type { BinaryExpression } from "estree";
import { chainRoot, importSourceOf, isCdkSource, unwrapWrappers } from "./lib/imports.js";

/**
 * Bans `instanceof` against a class reached through an `import`, because
 * `instanceof` is realm-bound and library `src/` is published dual ESM/CJS
 * (ADR-0007).
 *
 * When both copies of a package load in one process — the dual-package hazard —
 * each copy has its own class objects. An instance minted by one copy fails
 * `instanceof` against the other copy's class, so the check returns `false` for
 * a value that is plainly of that type. That has already shipped as two bugs:
 * #384 (a stack-singleton dedup silently skipped, colliding on a construct id)
 * and #385 (a `StatementBuilder` unrecognised, which skipped the
 * wildcard-resource security guard).
 *
 * **Every import is in scope, relative ones included.** A relative import is
 * not a same-realm guarantee: `./statement-builder.js` resolves separately in
 * each copy of the package, which is exactly how #385 happened.
 *
 * Not flagged, because neither can be duplicated by the hazard:
 * - **Globals and intrinsics** — `x instanceof RegExp`, `instanceof Error`.
 *   They resolve to no import binding, so the scope walk skips them.
 * - **Classes declared in the same module** — the class and every `new` of it
 *   come from one evaluation of that module.
 *
 * Resolution is scope-aware, so a local that shadows an import name is
 * correctly treated as a non-import binding, and TS-only wrappers (`as`, `!`,
 * `satisfies`, angle-bracket assertion) are unwrapped rather than trusted.
 *
 * Known gaps, both uncommon in our ESM src: `import = require()` bindings, and
 * an intermediate call that breaks the chain (`getClasses().Bucket`), which
 * reads a runtime value rather than the import.
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
