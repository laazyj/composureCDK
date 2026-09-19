import { rule } from "../../src/rules/no-realm-bound-instanceof.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("no-realm-bound-instanceof", rule, {
  valid: [
    {
      // Intrinsics are shared across realms — the dual-package hazard cannot
      // duplicate them. This is the live case in @composurecdk/cloudwatch's
      // policy-matcher, which must keep working.
      name: "an intrinsic global",
      code: `const matched = matcher instanceof RegExp;`,
    },
    {
      // The class and every `new` of it come from one evaluation of this
      // module, so there is no second copy to fail against.
      name: "a class declared in the same module",
      code: `
        class Local {}
        const ok = value instanceof Local;
      `,
    },
    {
      // Scope-aware: the parameter shadows the import, so this reads the
      // parameter, exactly as the runtime would.
      name: "a local binding that shadows an import name",
      code: `
        import { Bucket } from "aws-cdk-lib/aws-s3";
        function check(Bucket: unknown, value: unknown) {
          return value instanceof Bucket;
        }
      `,
    },
    {
      // A call breaks the chain: this reads a runtime value, not the import.
      name: "a call breaks the chain to the import",
      code: `
        import * as cdk from "aws-cdk-lib";
        const ok = value instanceof cdk.getClass().Bucket;
      `,
    },
    {
      name: "instanceof is not involved at all",
      code: `
        import { Bucket } from "aws-cdk-lib/aws-s3";
        const b = new Bucket(scope, "B");
      `,
    },
    {
      name: "assumeSingleInstance: a relative import is same-realm",
      code: `
        import { StatementBuilder } from "./statement-builder.js";
        export const is = (v) => v instanceof StatementBuilder;
      `,
      options: [{ assumeSingleInstance: true }],
    },
  ],
  invalid: [
    {
      // #384: the realm-bound dedup that collided on a construct id.
      name: "a named aws-cdk-lib import",
      code: `
        import { ResourcePolicy } from "aws-cdk-lib/aws-logs";
        if (existing instanceof ResourcePolicy) return existing;
      `,
      errors: [{ messageId: "cdkClass", data: { name: "ResourcePolicy" } }],
    },
    {
      name: "an aws-cdk-lib root import",
      code: `
        import { Stack } from "aws-cdk-lib";
        const ok = value instanceof Stack;
      `,
      errors: [{ messageId: "cdkClass", data: { name: "Stack" } }],
    },
    {
      // Reached through a namespace: the diagnostic must name the class, not
      // the namespace the chain is rooted at.
      name: "a namespaced aws-cdk-lib import",
      code: `
        import * as cdk from "aws-cdk-lib";
        const ok = value instanceof cdk.aws_s3.Bucket;
      `,
      errors: [{ messageId: "cdkClass", data: { name: "Bucket" } }],
    },
    {
      // #385: the relative import. This is the case that makes "relative means
      // same realm" wrong — each copy of the package resolves it separately.
      name: "a relative import of our own class",
      code: `
        import { StatementBuilder } from "./statement-builder.js";
        const built = s instanceof StatementBuilder ? s.build() : s;
      `,
      errors: [
        {
          messageId: "ownClass",
          data: { name: "StatementBuilder", source: "./statement-builder.js" },
        },
      ],
    },
    {
      name: "a sibling @composurecdk package import",
      code: `
        import { Ref } from "@composurecdk/core";
        const ok = value instanceof Ref;
      `,
      errors: [{ messageId: "ownClass", data: { name: "Ref", source: "@composurecdk/core" } }],
    },
    {
      // The TS-only wrappers must not smuggle the check past the rule.
      name: "an import behind a TS assertion",
      code: `
        import { Bucket } from "aws-cdk-lib/aws-s3";
        const ok = value instanceof (Bucket as any);
      `,
      errors: [{ messageId: "cdkClass" }],
    },
    {
      name: "an aliased import",
      code: `
        import { Bucket as S3Bucket } from "aws-cdk-lib/aws-s3";
        const ok = value instanceof S3Bucket;
      `,
      errors: [{ messageId: "cdkClass", data: { name: "S3Bucket" } }],
    },
    {
      name: "assumeSingleInstance does not excuse a bare specifier",
      code: `
        import { Bucket } from "aws-cdk-lib/aws-s3";
        export const is = (v) => v instanceof Bucket;
      `,
      options: [{ assumeSingleInstance: true }],
      errors: [{ messageId: "cdkClass" }],
    },
    {
      name: "assumeSingleInstance does not excuse a dependency's own class",
      code: `
        import { StatementBuilder } from "@composurecdk/iam";
        export const is = (v) => v instanceof StatementBuilder;
      `,
      options: [{ assumeSingleInstance: true }],
      errors: [{ messageId: "ownClass" }],
    },
    {
      name: "a `#` subpath is flagged even with assumeSingleInstance — it can map to a dependency",
      code: `
        import { Thing } from "#internal/thing.js";
        export const is = (v) => v instanceof Thing;
      `,
      options: [{ assumeSingleInstance: true }],
      errors: [{ messageId: "ownClass" }],
    },
    {
      name: "a `#` subpath is flagged by default",
      code: `
        import { Thing } from "#internal/thing.js";
        export const is = (v) => v instanceof Thing;
      `,
      errors: [{ messageId: "ownClass" }],
    },
    {
      name: "a relative import is still flagged by default",
      code: `
        import { StatementBuilder } from "./statement-builder.js";
        export const is = (v) => v instanceof StatementBuilder;
      `,
      errors: [{ messageId: "ownClass" }],
    },
  ],
});
