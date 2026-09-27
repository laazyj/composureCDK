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
    {
      name: "isCfn* at a floor that already has it",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const ok = CfnAlarm.isCfnAlarm(node);
      `,
      options: [{ floor: "2.231.0" }],
    },
    {
      name: "Match.stringLikeRegexp at a floor that already has it",
      code: `
        import { Match } from "aws-cdk-lib/assertions";
        const m = Match.stringLikeRegexp("^a");
      `,
      options: [{ floor: "2.9.0" }],
    },
    {
      name: "stringLikeRegexp on something that is not an aws-cdk-lib import",
      code: `
        import { Match } from "./my-matchers.js";
        const m = Match.stringLikeRegexp("^a");
      `,
    },
    {
      name: "addWarningV2 at a floor that already has it",
      code: `
        import { Annotations } from "aws-cdk-lib";
        Annotations.of(scope).addWarningV2("id", "message");
      `,
      options: [{ floor: "2.93.0" }],
    },
    {
      // The portable shim: feature-detect on a value the rule cannot trace to
      // the import, which is exactly what makes it safe below 2.93.0.
      name: "addWarningV2 feature-detected on a local",
      code: `
        import { Annotations } from "aws-cdk-lib";
        const annotations = Annotations.of(node);
        if (typeof annotations.addWarningV2 === "function") annotations.addWarningV2("id", "m");
      `,
    },
    {
      name: "the core Annotations, which is not the assertions helper",
      code: `
        import { Annotations } from "aws-cdk-lib";
        Annotations.of(scope).addWarning("message");
      `,
    },
    {
      name: "another export of aws-cdk-lib/assertions",
      code: `
        import { Template, Match } from "aws-cdk-lib/assertions";
        Template.fromStack(stack).hasResourceProperties("T", { A: Match.anyValue() });
      `,
    },
    {
      name: "Annotations from aws-cdk-lib/assertions at a floor that already has it",
      code: `
        import { Annotations } from "aws-cdk-lib/assertions";
        Annotations.fromStack(stack).hasNoWarning("*", "*");
      `,
      options: [{ floor: "2.10.0" }],
    },
    {
      name: "a same-named export of an unrelated module",
      code: `
        import * as assertions from "./assertions.js";
        const a = assertions.Annotations;
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
    {
      name: "isCfn* at a floor below 2.231.0",
      code: `
        import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
        const ok = CfnAlarm.isCfnAlarm(node);
      `,
      options: [{ floor: "2.230.0" }],
      errors: [{ message: /in aws-cdk-lib 2\.231\.0, above the floor of 2\.230\.0 —/ }],
    },
    {
      name: "Match.stringLikeRegexp below 2.9.0",
      code: `
        import { Match } from "aws-cdk-lib/assertions";
        const m = Match.stringLikeRegexp("^a");
      `,
      options: [{ floor: "2.1.0" }],
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      // Floors compare numerically, not as strings: "2.10.0" < "2.9.0" as text.
      name: "a floor whose minor has more digits than the entry's",
      code: `
        import { Annotations } from "aws-cdk-lib";
        Annotations.of(scope).addWarningV2("id", "message");
      `,
      options: [{ floor: "2.10.0" }],
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "addWarningV2 through the Annotations.of call, below 2.93.0",
      code: `
        import * as cdk from "aws-cdk-lib";
        cdk.Annotations.of(scope).addWarningV2("id", "message");
      `,
      options: [{ floor: "2.92.0" }],
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "a named import of Annotations from aws-cdk-lib/assertions",
      code: `
        import { Annotations, Match } from "aws-cdk-lib/assertions";
        Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
      `,
      options: [{ floor: "2.9.0" }],
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      // It still fails the floor's typecheck, so a type-only import counts.
      name: "an aliased, type-only import of Annotations",
      code: `
        import type { Annotations as A } from "aws-cdk-lib/assertions";
        let a: A;
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "Annotations off a `* as` assertions namespace",
      code: `
        import * as assertions from "aws-cdk-lib/assertions";
        assertions.Annotations.fromStack(stack);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "Annotations off the root's assertions re-export",
      code: `
        import { assertions } from "aws-cdk-lib";
        assertions.Annotations.fromStack(stack);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "Annotations off the whole-library namespace",
      code: `
        import * as cdk from "aws-cdk-lib";
        cdk.assertions.Annotations.fromStack(stack);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
  ],
});
