import { expect, it } from "vitest";
import * as bedrock from "aws-cdk-lib/aws-bedrock";

// Constructs we wrap or model ourselves because the L2 is still in
// @aws-cdk/aws-bedrock-alpha. A failure means aws-cdk-lib has graduated that
// L2: act on the linked issue, then delete its row.
it.each([
  ["Guardrail", "#533"],
  ["ApplicationInferenceProfile", "#534"],
  ["CrossRegionInferenceProfile", "#536"],
])("aws-cdk-lib has no stable %s L2 yet (%s)", (l2) => {
  expect(Object.keys(bedrock).filter((name) => name.startsWith(l2))).toEqual([]);
});
