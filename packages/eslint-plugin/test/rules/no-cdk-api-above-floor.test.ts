import { rule } from "../../src/rules/no-cdk-api-above-floor.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("no-cdk-api-above-floor", rule, {
  valid: [
    {
      name: "the portable bare-call helper (not member access)",
      code: `
        import { isCfnAlarm } from "./policy-matcher.js";
        if (isCfnAlarm(node)) attach(node);
      `,
    },
    {
      name: "the foundational CfnResource.isCfnResource guard",
      code: `
        import { CfnResource } from "aws-cdk-lib";
        const ok = CfnResource.isCfnResource(node) && node.cfnResourceType === T;
      `,
    },
    {
      name: "the foundational CfnElement.isCfnElement guard",
      code: `
        import { CfnElement } from "aws-cdk-lib";
        const ok = CfnElement.isCfnElement(node);
      `,
    },
    {
      name: "an unrelated method that merely starts with 'is'",
      code: `
        const ok = thing.isReady();
      `,
    },
    {
      name: "accessing CFN_RESOURCE_TYPE_NAME",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const t = CfnAlarm.CFN_RESOURCE_TYPE_NAME;
      `,
    },
    {
      // The reviewer's case: a same-named member on something that is NOT an
      // aws-cdk-lib import must not be flagged.
      name: "isCfn* on a non-aws-cdk-lib import",
      code: `
        import { CfnAlarm } from "./my-local-cfn.js";
        const ok = CfnAlarm.isCfnAlarm(node);
      `,
    },
    {
      name: "isCfn* on a plain local value",
      code: `
        const widget = makeWidget();
        const ok = widget.isCfnWhatever(node);
      `,
    },
    {
      // A call breaks the chain root: the receiver is a runtime value, not the
      // imported class, so this isn't the version-gated static.
      name: "a call breaks the chain to the cdk import",
      code: `
        import { Stack } from "aws-cdk-lib";
        const ok = Stack.of(scope).isCfnWhatever(node);
      `,
    },
    {
      // Scope-aware resolution: a local that shadows the import name is not
      // the cdk class, so the rule must not fire on it.
      name: "a local that shadows a cdk import is not flagged",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        function check(scope) {
          const CfnAlarm = { isCfnAlarm: () => true };
          return CfnAlarm.isCfnAlarm(scope);
        }
      `,
    },
    {
      // The allow-list still gates members reached on a cdk-rooted chain.
      name: "an allow-listed guard on a cdk import",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const ok = CfnAlarm.isCfnResource(node);
      `,
    },
    {
      // `import = require` produces an `ImportBinding` def whose parent is a
      // `TSImportEqualsDeclaration`, not an `ImportDeclaration`. The rule must
      // skip those (and not crash on the missing `.source`).
      name: "import = require (untracked, must not crash)",
      code: `
        import CfnAlarm = require("aws-cdk-lib/aws-cloudwatch");
        const ok = CfnAlarm.isCfnAlarm(node);
      `,
    },
  ],
  invalid: [
    {
      name: "CfnAlarm.isCfnAlarm (added in 2.231.0)",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        if (CfnAlarm.isCfnAlarm(node)) attach(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "CfnCompositeAlarm.isCfnCompositeAlarm",
      code: `
        import { CfnCompositeAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const composite = CfnCompositeAlarm.isCfnCompositeAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "the family generalises to any generated L1 guard",
      code: `
        import { CfnBucket } from "aws-cdk-lib/aws-s3";
        const b = CfnBucket.isCfnBucket(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "an aliased aws-cdk-lib import",
      code: `
        import { CfnAlarm as Alarm } from "aws-cdk-lib/aws-cloudwatch";
        const ok = Alarm.isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "a `* as` submodule namespace import",
      code: `
        import * as cw from "aws-cdk-lib/aws-cloudwatch";
        const ok = cw.CfnAlarm.isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "a named submodule import used as a namespace",
      code: `
        import { aws_cloudwatch as cw } from "aws-cdk-lib";
        const ok = cw.CfnAlarm.isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "a deep chain off the whole-library namespace import",
      code: `
        import * as cdk from "aws-cdk-lib";
        const ok = cdk.aws_cloudwatch.CfnAlarm.isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      // A TS `as` cast must not smuggle the call past the rule.
      name: "a TS `as` cast at the chain root",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const ok = (CfnAlarm as typeof CfnAlarm).isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "a TS non-null assertion at the chain root",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const ok = CfnAlarm!.isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "a TS `satisfies` at the chain root",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const ok = (CfnAlarm satisfies object).isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      // Optional chaining must not defeat the rule either.
      name: "an optional chain off the namespace import",
      code: `
        import * as cdk from "aws-cdk-lib";
        const ok = cdk?.aws_cloudwatch.CfnAlarm.isCfnAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
  ],
});
