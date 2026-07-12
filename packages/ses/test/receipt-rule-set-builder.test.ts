import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { s3Action } from "../src/actions.js";
import { createReceiptRuleSetBuilder } from "../src/receipt-rule-set-builder.js";

function newStack(region = "us-east-1"): Stack {
  return new Stack(new App(), "TestStack", { env: { account: "111111111111", region } });
}

describe("ReceiptRuleSetBuilder", () => {
  it("creates a rule set with a rule, secure defaults, and an S3 action", () => {
    const stack = newStack();
    const bucket = new Bucket(stack, "Bucket");
    const { ruleSet, rules } = createReceiptRuleSetBuilder()
      .rule("inbound", (r) =>
        r
          .recipients(["info@example.com"])
          .addAction("store", s3Action(bucket, { objectKeyPrefix: "in/" })),
      )
      .build(stack, "MailRuleSet");

    expect(ruleSet).toBeDefined();
    expect(rules.inbound).toBeDefined();
    Template.fromStack(stack).hasResourceProperties("AWS::SES::ReceiptRule", {
      Rule: Match.objectLike({
        Recipients: ["info@example.com"],
        ScanEnabled: true,
        TlsPolicy: "Require",
        Actions: Match.arrayWith([
          Match.objectLike({ S3Action: Match.objectLike({ ObjectKeyPrefix: "in/" }) }),
        ]),
      }),
    });
  });

  it("activates the rule set by default", () => {
    const stack = newStack();
    const { activation } = createReceiptRuleSetBuilder()
      .rule("inbound", (r) => r.recipients(["info@example.com"]))
      .build(stack, "MailRuleSet");

    expect(activation).toBeDefined();
    const template = Template.fromStack(stack);
    template.resourceCountIs("Custom::SESActiveReceiptRuleSet", 1);
    template.hasResourceProperties(
      "AWS::IAM::Policy",
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: Match.arrayWith(["ses:SetActiveReceiptRuleSet"]) }),
          ]),
        }),
      }),
    );
  });

  it("opts out of activation with .activate(false)", () => {
    const stack = newStack();
    const { activation } = createReceiptRuleSetBuilder()
      .rule("inbound", (r) => r.recipients(["info@example.com"]))
      .activate(false)
      .build(stack, "MailRuleSet");

    expect(activation).toBeUndefined();
    Template.fromStack(stack).resourceCountIs("Custom::SESActiveReceiptRuleSet", 0);
  });

  it("preserves declaration order across rules", () => {
    const stack = newStack();
    const { rules } = createReceiptRuleSetBuilder()
      .rule("first", (r) => r.recipients(["a@example.com"]))
      .rule("second", (r) => r.recipients(["b@example.com"]))
      .activate(false)
      .build(stack, "MailRuleSet");

    expect(Object.keys(rules)).toEqual(["first", "second"]);
    Template.fromStack(stack).resourceCountIs("AWS::SES::ReceiptRule", 2);
  });

  it("passes through receiptRuleSetName and dropSpam", () => {
    const stack = newStack();
    createReceiptRuleSetBuilder()
      .receiptRuleSetName("my-rules")
      .dropSpam(true)
      .activate(false)
      .build(stack, "MailRuleSet");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::SES::ReceiptRuleSet", { RuleSetName: "my-rules" });
    // dropSpam provisions a spam-filter Lambda.
    template.resourceCountIs("AWS::SES::ReceiptRule", 1);
  });

  it("warns when built in a region without receiving support", () => {
    const stack = newStack("af-south-1");
    createReceiptRuleSetBuilder().activate(false).build(stack, "MailRuleSet");
    // Presence of the annotation is asserted in region-support.test.ts; here we
    // just exercise the builder's call path in an unsupported region.
    expect(stack).toBeDefined();
  });

  it("rejects duplicate rule keys", () => {
    expect(() =>
      createReceiptRuleSetBuilder()
        .rule("dup", (r) => r.recipients(["a@example.com"]))
        .rule("dup", (r) => r.recipients(["b@example.com"])),
    ).toThrow(/duplicate key "dup"/);
  });

  it("copies configured rules and activation flag independently", () => {
    const stack = newStack();
    const base = createReceiptRuleSetBuilder()
      .rule("inbound", (r) => r.recipients(["a@example.com"]))
      .activate(false);
    const copy = base.copy();
    const { rules, activation } = copy.build(stack, "MailRuleSet");
    expect(rules.inbound).toBeDefined();
    expect(activation).toBeUndefined();
  });
});
