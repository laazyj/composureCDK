import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createBudgetAlarms } from "../src/budget-alarms.js";

function newStack(region: string | null = "us-east-1"): Stack {
  const app = new App();
  return new Stack(app, "TestStack", region === null ? undefined : { env: { region } });
}

describe("createBudgetAlarms", () => {
  it("returns {} when config is undefined", () => {
    const stack = newStack();

    const alarms = createBudgetAlarms(stack, "Budget", undefined);

    expect(alarms).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("returns {} when config is false", () => {
    const stack = newStack();

    const alarms = createBudgetAlarms(stack, "Budget", false);

    expect(alarms).toEqual({});
  });

  it("returns {} when enabled is explicitly false", () => {
    const stack = newStack();

    const alarms = createBudgetAlarms(stack, "Budget", { enabled: false });

    expect(alarms).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("returns {} when estimatedCharges config is not provided", () => {
    const stack = newStack();

    const alarms = createBudgetAlarms(stack, "Budget", { enabled: true });

    expect(alarms).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("creates an EstimatedCharges alarm with USD default currency", () => {
    const stack = newStack();

    const alarms = createBudgetAlarms(stack, "Budget", {
      estimatedCharges: { threshold: 50 },
    });

    expect(Object.keys(alarms)).toEqual(["estimatedCharges"]);
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Billing",
      MetricName: "EstimatedCharges",
      Threshold: 50,
      Dimensions: Match.arrayWith([Match.objectLike({ Name: "Currency", Value: "USD" })]),
    });
  });

  it("honours a custom currency", () => {
    const stack = newStack();

    createBudgetAlarms(stack, "Budget", {
      estimatedCharges: { threshold: 25, currency: "GBP" },
    });

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Dimensions: Match.arrayWith([Match.objectLike({ Name: "Currency", Value: "GBP" })]),
    });
  });

  describe("region guard", () => {
    it("throws when the stack is deployed to a region other than us-east-1", () => {
      const stack = newStack("eu-west-1");

      expect(() =>
        createBudgetAlarms(stack, "Budget", {
          estimatedCharges: { threshold: 50 },
        }),
      ).toThrow(/us-east-1/);
    });

    it("throws when the stack has no concrete region pinned", () => {
      const stack = newStack(null);

      expect(() =>
        createBudgetAlarms(stack, "Budget", {
          estimatedCharges: { threshold: 50 },
        }),
      ).toThrow(/concrete region/);
    });

    it("does not run the guard when estimatedCharges is not configured", () => {
      const stack = newStack("eu-west-1");

      expect(() => createBudgetAlarms(stack, "Budget", { enabled: true })).not.toThrow();
    });
  });
});
