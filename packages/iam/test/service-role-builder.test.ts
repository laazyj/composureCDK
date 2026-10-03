import { describe, it } from "vitest";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { buildFixture } from "@composurecdk/cdk-testing";
import { createServiceRoleBuilder } from "../src/service-role-builder.js";

const buildAndSynth = buildFixture(() => createServiceRoleBuilder("lambda.amazonaws.com"), "Role");

/** The role's trust policy is exactly one statement trusting `service`. */
function trustPolicy(service: string) {
  return {
    AssumeRolePolicyDocument: {
      Statement: [{ Action: "sts:AssumeRole", Effect: "Allow", Principal: { Service: service } }],
    },
  };
}

describe("createServiceRoleBuilder", () => {
  it("trusts the given service principal", () => {
    const { template } = buildAndSynth();
    template.hasResourceProperties("AWS::IAM::Role", trustPolicy("lambda.amazonaws.com"));
  });

  it("lets a later assumedBy override the preset principal", () => {
    const { template } = buildAndSynth((b) =>
      b.assumedBy(new ServicePrincipal("budgets.amazonaws.com")),
    );
    template.hasResourceProperties("AWS::IAM::Role", trustPolicy("budgets.amazonaws.com"));
  });
});
