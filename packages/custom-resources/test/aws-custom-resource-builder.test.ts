import { describe, it, expect } from "vitest";
import { App, Stack, type CfnResource } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createAwsCustomResourceBuilder } from "../src/aws-custom-resource-builder.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack");
}

function onlyCustomResource(stack: Stack): {
  Properties: Record<string, unknown>;
  DependsOn?: string[];
} {
  return Object.values(Template.fromStack(stack).findResources("Custom::AWS"))[0] as {
    Properties: Record<string, unknown>;
    DependsOn?: string[];
  };
}

describe("AwsCustomResourceBuilder", () => {
  describe("synthesised output", () => {
    it("renders the configured lifecycle calls and the installLatestAwsSdk default", () => {
      const stack = newStack();
      createAwsCustomResourceBuilder()
        .onCreate({
          service: "SES",
          action: "setActiveReceiptRuleSet",
          parameters: { RuleSetName: "prod-rules" },
          physicalResourceId: PhysicalResourceId.of("active-rule-set"),
        })
        .onDelete({ service: "SES", action: "setActiveReceiptRuleSet" })
        .allow(["ses:SetActiveReceiptRuleSet"], ["*"])
        .build(stack, "Activate");

      const cr = onlyCustomResource(stack);
      expect(cr.Properties.Create).toBeDefined();
      expect(cr.Properties.Delete).toBeDefined();
      expect(cr.Properties.InstallLatestAwsSdk).toBe(false);
      expect(cr.Properties.Create as string).toContain("prod-rules");
    });

    it("lets the user override installLatestAwsSdk", () => {
      const stack = newStack();
      createAwsCustomResourceBuilder()
        .onUpdate({
          service: "S3",
          action: "listBuckets",
          physicalResourceId: PhysicalResourceId.of("x"),
        })
        .installLatestAwsSdk(true)
        .allow(["s3:ListAllMyBuckets"], ["*"])
        .build(stack, "List");

      expect(onlyCustomResource(stack).Properties.InstallLatestAwsSdk).toBe(true);
    });

    it("scopes the IAM policy from .allow(actions, resources)", () => {
      const stack = newStack();
      createAwsCustomResourceBuilder()
        .onCreate({
          service: "SES",
          action: "setActiveReceiptRuleSet",
          parameters: {},
          physicalResourceId: PhysicalResourceId.of("x"),
        })
        .allow(["ses:SetActiveReceiptRuleSet"], ["*"])
        .build(stack, "Activate");

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "ses:SetActiveReceiptRuleSet",
              Effect: "Allow",
              Resource: "*",
            }),
          ]),
        },
      });
    });
  });

  describe("Resolvable parameters", () => {
    it("resolves a ref in parameters against the build context", () => {
      const stack = newStack();
      createAwsCustomResourceBuilder()
        .onCreate({
          service: "SES",
          action: "setActiveReceiptRuleSet",
          parameters: ref<{ name: string }>("ruleSet").map((r) => ({ RuleSetName: r.name })),
          physicalResourceId: PhysicalResourceId.of("x"),
        })
        .allow(["ses:SetActiveReceiptRuleSet"], ["*"])
        .build(stack, "Activate", { ruleSet: { name: "resolved-rule-set" } });

      expect(onlyCustomResource(stack).Properties.Create as string).toContain("resolved-rule-set");
    });

    it("throws when a parameters ref names a component not in context", () => {
      expect(() =>
        createAwsCustomResourceBuilder()
          .onCreate({
            service: "SES",
            action: "setActiveReceiptRuleSet",
            parameters: ref<{ name: string }>("missing").map((r) => ({ RuleSetName: r.name })),
          })
          .allow(["ses:SetActiveReceiptRuleSet"], ["*"])
          .build(newStack(), "Activate", {}),
      ).toThrow(/not found/);
    });
  });

  describe("dependsOn ordering", () => {
    it("adds a precise DependsOn on only the named component, even with a hardcoded parameter", () => {
      const stack = newStack();
      const ruleSet = new Topic(stack, "RuleSet");
      const other = new Topic(stack, "Other");

      createAwsCustomResourceBuilder()
        .onCreate({
          service: "SES",
          action: "setActiveReceiptRuleSet",
          parameters: { RuleSetName: "prod-rules" }, // hardcoded string — no token
          physicalResourceId: PhysicalResourceId.of("active-rule-set"),
        })
        .dependsOn(ref<{ ruleSet: Topic }>("ruleSet"))
        .allow(["ses:SetActiveReceiptRuleSet"], ["*"])
        .build(stack, "Activate", {
          ruleSet: { ruleSet },
          other: { other }, // a sibling in context that is NOT named by dependsOn
        });

      const dependsOn = onlyCustomResource(stack).DependsOn ?? [];
      expect(dependsOn).toContain(stack.getLogicalId(ruleSet.node.defaultChild as CfnResource));
      expect(dependsOn).not.toContain(stack.getLogicalId(other.node.defaultChild as CfnResource));
    });

    it("throws when a dependsOn ref names a component not in context", () => {
      expect(() =>
        createAwsCustomResourceBuilder()
          .onCreate({
            service: "SES",
            action: "setActiveReceiptRuleSet",
            parameters: {},
            physicalResourceId: PhysicalResourceId.of("x"),
          })
          .dependsOn(ref<{ x: Topic }>("missing"))
          .allow(["ses:SetActiveReceiptRuleSet"], ["*"])
          .build(newStack(), "Activate", {}),
      ).toThrow(/not found/);
    });
  });

  describe("IAM policy configuration", () => {
    it("throws when no call is configured", () => {
      expect(() =>
        createAwsCustomResourceBuilder()
          .allow(["s3:ListAllMyBuckets"], ["*"])
          .build(newStack(), "X"),
      ).toThrow(/onCreate\/onUpdate\/onDelete/);
    });

    it("throws when no policy, allow, or role is supplied", () => {
      expect(() =>
        createAwsCustomResourceBuilder()
          .onCreate({ service: "S3", action: "listBuckets" })
          .build(newStack(), "X"),
      ).toThrow(/IAM policy is required/);
    });

    it("throws when both .allow() and .policy() are used", () => {
      expect(() =>
        createAwsCustomResourceBuilder()
          .onCreate({ service: "S3", action: "listBuckets" })
          .allow(["s3:ListAllMyBuckets"], ["*"])
          .policy(
            AwsCustomResourcePolicy.fromSdkCalls({
              resources: AwsCustomResourcePolicy.ANY_RESOURCE,
            }),
          )
          .build(newStack(), "X"),
      ).toThrow(/not both/);
    });

    it("accepts a full AwsCustomResourcePolicy via .policy()", () => {
      const stack = newStack();
      createAwsCustomResourceBuilder()
        .onCreate({
          service: "S3",
          action: "listBuckets",
          physicalResourceId: PhysicalResourceId.of("x"),
        })
        .policy(
          AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
        )
        .build(stack, "List");

      Template.fromStack(stack).resourceCountIs("Custom::AWS", 1);
    });

    it("allows omitting the policy when a role is supplied", () => {
      const stack = newStack();
      const role = new Role(stack, "ProviderRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      });
      createAwsCustomResourceBuilder()
        .onCreate({
          service: "S3",
          action: "listBuckets",
          physicalResourceId: PhysicalResourceId.of("x"),
        })
        .role(role)
        .build(stack, "List");

      Template.fromStack(stack).resourceCountIs("Custom::AWS", 1);
    });
  });

  describe("copy()", () => {
    it("preserves configured state independently of the original", () => {
      assertCopyPreservesState({
        factory: () =>
          createAwsCustomResourceBuilder().allow(["s3:GetObject"], ["arn:aws:s3:::b/*"]),
        configure: (b) =>
          b.onCreate({
            service: "S3",
            action: "getObject",
            parameters: { Bucket: "b", Key: "k" },
            physicalResourceId: PhysicalResourceId.of("x"),
          }),
        mutate: (b) =>
          b.onDelete({
            service: "S3",
            action: "deleteObject",
            parameters: { Bucket: "b", Key: "k" },
          }),
        build: (b) => {
          const stack = newStack();
          b.build(stack, "CR");
          return stack;
        },
        inspect: (stack) => Object.keys(onlyCustomResource(stack).Properties).sort(),
      });
    });
  });
});
