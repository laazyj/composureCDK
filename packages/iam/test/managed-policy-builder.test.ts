import { describe, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { createManagedPolicyBuilder } from "../src/managed-policy-builder.js";
import { createStatementBuilder } from "../src/statement-builder.js";

function synth(configureFn: (b: ReturnType<typeof createManagedPolicyBuilder>) => void): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createManagedPolicyBuilder();
  configureFn(builder);
  builder.build(stack, "TestPolicy");
  return Template.fromStack(stack);
}

describe("ManagedPolicyBuilder", () => {
  it("creates a customer-managed policy with the supplied statements", () => {
    const template = synth((b) =>
      b.managedPolicyName("ops-boundary").statements([
        new PolicyStatement({
          actions: ["s3:GetObject"],
          resources: ["arn:aws:s3:::my-bucket/*"],
        }),
      ]),
    );

    template.resourceCountIs("AWS::IAM::ManagedPolicy", 1);
    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      ManagedPolicyName: "ops-boundary",
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: "s3:GetObject",
            Resource: "arn:aws:s3:::my-bucket/*",
          }),
        ]),
      }),
    });
  });

  it("appends statements added via addStatements to those from props", () => {
    const template = synth((b) =>
      b
        .statements([
          new PolicyStatement({
            actions: ["s3:GetObject"],
            resources: ["arn:aws:s3:::bucket-a/*"],
          }),
        ])
        .addStatements([
          createStatementBuilder()
            .allow()
            .actions(["s3:PutObject"])
            .resources(["arn:aws:s3:::bucket-b/*"]),
        ]),
    );

    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "s3:GetObject" }),
          Match.objectLike({ Action: "s3:PutObject" }),
        ]),
      }),
    });
  });
});
