import { expect, it } from "vitest";
import * as bedrock from "aws-cdk-lib/aws-bedrock";

// Builders that wrap an L1 because the L2 is still in @aws-cdk/aws-bedrock-alpha.
// A failure means aws-cdk-lib has graduated that L2: migrate the builder as the
// linked issue describes, then delete its row.
it.each([
  ["Guardrail", "#533"],
  ["ApplicationInferenceProfile", "#534"],
])("aws-cdk-lib has no stable %s L2 yet (%s)", (l2) => {
  expect(Object.keys(bedrock).filter((name) => name.startsWith(l2))).toEqual([]);
});
