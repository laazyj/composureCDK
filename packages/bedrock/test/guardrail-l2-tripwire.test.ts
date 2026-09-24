import { expect, it } from "vitest";
import * as bedrock from "aws-cdk-lib/aws-bedrock";

it("wraps CfnGuardrail only while aws-cdk-lib has no stable Guardrail L2 (#533)", () => {
  // Failing means aws-cdk-lib has graduated the Guardrail L2: move
  // createGuardrailBuilder onto it as #533 describes, then delete this test.
  expect(Object.keys(bedrock).filter((name) => name.startsWith("Guardrail"))).toEqual([]);
});
