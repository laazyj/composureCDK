import { describe, expect, it } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ManagedPolicy, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { createRoleBuilder } from "../src/role-builder.js";
import { createStatementBuilder, WildcardResourceError } from "../src/statement-builder.js";

function synth(configureFn?: (builder: ReturnType<typeof createRoleBuilder>) => void): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createRoleBuilder().assumedBy(new ServicePrincipal("lambda.amazonaws.com"));
  configureFn?.(builder);
  builder.build(stack, "TestRole");
  return Template.fromStack(stack);
}

describe("RoleBuilder", () => {
  describe("build", () => {
    it("returns a RoleBuilderResult with role and inlinePolicies fields", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createRoleBuilder()
        .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
        .build(stack, "TestRole");

      expect(result.role).toBeDefined();
      expect(result.inlinePolicies).toEqual({});
    });

    it("throws when assumedBy is not configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createRoleBuilder();

      expect(() => builder.build(stack, "TestRole")).toThrow(/assumedBy/);
    });

    it("creates exactly one IAM role", () => {
      const template = synth();
      template.resourceCountIs("AWS::IAM::Role", 1);
    });
  });

  describe("defaults", () => {
    it("caps max session duration at one hour by default", () => {
      const template = synth();
      template.hasResourceProperties("AWS::IAM::Role", {
        MaxSessionDuration: 3600,
      });
    });

    it("applies the trust policy from assumedBy", () => {
      const template = synth();
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Principal: { Service: "lambda.amazonaws.com" },
              Action: "sts:AssumeRole",
            }),
          ]),
        }),
      });
    });

    it("allows the caller to override maxSessionDuration", () => {
      const template = synth((b) => b.maxSessionDuration(Duration.hours(4)));
      template.hasResourceProperties("AWS::IAM::Role", {
        MaxSessionDuration: 14400,
      });
    });
  });

  describe("addInlinePolicyStatements", () => {
    it("embeds the statements in the Role as a truly inline policy", () => {
      const template = synth((b) =>
        b.addInlinePolicyStatements("StopEC2", [
          new PolicyStatement({
            actions: ["ec2:StopInstances"],
            resources: ["*"],
          }),
        ]),
      );

      template.resourceCountIs("AWS::IAM::Policy", 0);
      template.hasResourceProperties("AWS::IAM::Role", {
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyName: "StopEC2",
            PolicyDocument: Match.objectLike({
              Statement: Match.arrayWith([
                Match.objectLike({
                  Effect: "Allow",
                  Action: "ec2:StopInstances",
                  Resource: "*",
                }),
              ]),
            }),
          }),
        ]),
      });
    });

    it("accepts StatementBuilders and resolves them at build time", () => {
      const template = synth((b) =>
        b.addInlinePolicyStatements("StopEC2", [
          createStatementBuilder()
            .allow()
            .actions(["ec2:StopInstances", "ec2:DescribeInstances"])
            .resources(["*"])
            .allowWildcardResources(true),
        ]),
      );

      template.hasResourceProperties("AWS::IAM::Role", {
        Policies: Match.arrayWith([Match.objectLike({ PolicyName: "StopEC2" })]),
      });
    });

    it("propagates StatementBuilder wildcard errors at build time", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createRoleBuilder()
        .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
        .addInlinePolicyStatements("TooBroad", [
          createStatementBuilder().allow().actions(["ec2:DescribeInstances"]).resources(["*"]),
        ]);

      expect(() => builder.build(stack, "TestRole")).toThrow(WildcardResourceError);
    });

    it("exposes each inline policy in the result, keyed by name", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createRoleBuilder()
        .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
        .addInlinePolicyStatements("PolicyA", [
          new PolicyStatement({ actions: ["s3:GetObject"], resources: ["*"] }),
        ])
        .addInlinePolicyStatements("PolicyB", [
          new PolicyStatement({ actions: ["s3:PutObject"], resources: ["*"] }),
        ])
        .build(stack, "TestRole");

      expect(Object.keys(result.inlinePolicies).sort()).toEqual(["PolicyA", "PolicyB"]);
    });
  });

  describe("managed policies", () => {
    it("attaches managed policies passed via managedPolicies", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const managed = ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole",
      );
      createRoleBuilder()
        .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
        .managedPolicies([managed])
        .build(stack, "TestRole");

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            "Fn::Join": Match.arrayWith([
              Match.arrayWith([Match.stringLikeRegexp("AWSLambdaBasicExecutionRole")]),
            ]),
          }),
        ]),
      });
    });
  });
});
