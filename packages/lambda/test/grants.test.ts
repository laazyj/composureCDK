import { expect, it } from "vitest";

import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { describeGrants, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { functionGrants } from "../src/grants.js";

describeGrants({
  name: "functionGrants",
  grants: functionGrants,
  // The grantee of a function invoke is typically an API, not another function.
  assumedBy: "apigateway.amazonaws.com",
  makeResource: (stack) =>
    new LambdaFunction(stack, "Fn", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline("exports.handler = async () => {};"),
    }),
  cases: [
    { capability: "invoke", grants: ["lambda:InvokeFunction"] },
    { capability: "invokeUrl", grants: ["lambda:InvokeFunctionUrl"] },
  ],
  extra: (setup) => {
    it("resolves a Resolvable function from the build context before granting", () => {
      const { stack, resource: fn, role } = setup();

      functionGrants
        .invoke(ref<{ function: LambdaFunction }, LambdaFunction>("handler", (r) => r.function))
        .applyTo(role, { handler: { function: fn } });

      expect(policyJson(stack)).toContain("lambda:InvokeFunction");
    });
  },
});
