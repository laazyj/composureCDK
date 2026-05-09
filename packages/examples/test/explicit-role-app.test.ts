import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createExplicitRoleApp } from "../src/explicit-role-app.js";

describe("explicit-role-app", () => {
  const { stack } = createExplicitRoleApp();
  const template = Template.fromStack(stack);

  it("creates one Lambda function and one execution role", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::IAM::Role", 1);
  });

  it("does not attach AWSLambdaBasicExecutionRole to the execution role", () => {
    const roles = template.findResources("AWS::IAM::Role");
    expect(JSON.stringify(roles)).not.toContain("AWSLambdaBasicExecutionRole");
  });

  it("attaches both LogsWriter and UploadsRead inline policies", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      Policies: Match.arrayWith([
        Match.objectLike({ PolicyName: "LogsWriter" }),
        Match.objectLike({
          PolicyName: "UploadsRead",
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Action: ["s3:GetObject", "s3:ListBucket"],
              }),
            ]),
          }),
        }),
      ]),
    });
  });
});
