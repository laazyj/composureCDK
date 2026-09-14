import type { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

/**
 * Synthesises `stack` and returns its whole template as a JSON string.
 *
 * The intended use is a substring assertion over IAM policy documents, where
 * naming the exact statement would mean reproducing CDK's `Fn::Join` /
 * `Fn::GetAtt` structure around the one action under test:
 *
 * ```ts
 * expect(policyJson(stack)).toContain("kms:Decrypt");
 * ```
 *
 * That is deliberately a coarse check — it proves the action reached *a*
 * policy in the stack, not which principal holds it. Prefer
 * `Template.fromStack(stack).hasResourceProperties(...)` where the assertion
 * is about a specific policy's shape.
 */
export function policyJson(stack: Stack): string {
  return JSON.stringify(Template.fromStack(stack).toJSON());
}
