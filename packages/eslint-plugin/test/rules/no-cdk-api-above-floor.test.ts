import { rule } from "../../src/rules/no-cdk-api-above-floor.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("no-cdk-api-above-floor", rule, {
  valid: [
    {
      name: "the portable bare-call helper (not member access)",
      code: `
        if (isCfnAlarm(node)) attach(node);
      `,
    },
    {
      name: "the foundational CfnResource.isCfnResource guard",
      code: `
        const ok = CfnResource.isCfnResource(node) && node.cfnResourceType === T;
      `,
    },
    {
      name: "the foundational CfnElement.isCfnElement guard",
      code: `
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
        const t = CfnAlarm.CFN_RESOURCE_TYPE_NAME;
      `,
    },
    {
      name: "defining our own isCfnAlarm helper",
      code: `
        export function isCfnAlarm(x) {
          return CfnResource.isCfnResource(x) && x.cfnResourceType === CfnAlarm.CFN_RESOURCE_TYPE_NAME;
        }
      `,
    },
  ],
  invalid: [
    {
      name: "CfnAlarm.isCfnAlarm (added in 2.231.0)",
      code: `
        if (CfnAlarm.isCfnAlarm(node)) attach(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "CfnCompositeAlarm.isCfnCompositeAlarm",
      code: `
        const composite = CfnCompositeAlarm.isCfnCompositeAlarm(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
    {
      name: "the family generalises to any generated L1 guard",
      code: `
        const b = CfnBucket.isCfnBucket(node);
      `,
      errors: [{ messageId: "aboveFloor" }],
    },
  ],
});
