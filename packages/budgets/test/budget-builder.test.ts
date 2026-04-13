import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { ref } from "@composurecdk/core";
import { createBudgetBuilder } from "../src/budget-builder.js";

function newStack(): Stack {
  const app = new App();
  return new Stack(app, "TestStack");
}

describe("BudgetBuilder", () => {
  describe("build", () => {
    it("returns a result exposing budget, topicPolicies, and alarms", () => {
      const stack = newStack();
      const result = createBudgetBuilder()
        .budgetName("Test")
        .limit({ amount: 10 })
        .build(stack, "TestBudget");

      expect(result.budget).toBeDefined();
      expect(result.topicPolicies).toEqual({});
      expect(result.alarms).toEqual({});
    });

    it("creates exactly one AWS::Budgets::Budget", () => {
      const stack = newStack();
      createBudgetBuilder().limit({ amount: 10 }).build(stack, "TestBudget");

      Template.fromStack(stack).resourceCountIs("AWS::Budgets::Budget", 1);
    });

    it("applies MONTHLY / COST / USD defaults", () => {
      const stack = newStack();
      createBudgetBuilder()
        .budgetName("Default")
        .limit({ amount: 50 })
        .build(stack, "DefaultBudget");

      Template.fromStack(stack).hasResourceProperties("AWS::Budgets::Budget", {
        Budget: Match.objectLike({
          BudgetName: "Default",
          BudgetType: "COST",
          TimeUnit: "MONTHLY",
          BudgetLimit: { Amount: 50, Unit: "USD" },
        }),
      });
    });

    it("honours a caller-supplied limit unit", () => {
      const stack = newStack();
      createBudgetBuilder().limit({ amount: 25, unit: "GBP" }).build(stack, "GbpBudget");

      Template.fromStack(stack).hasResourceProperties("AWS::Budgets::Budget", {
        Budget: Match.objectLike({
          BudgetLimit: { Amount: 25, Unit: "GBP" },
        }),
      });
    });

    it("passes costFilters through to CloudFormation", () => {
      const stack = newStack();
      createBudgetBuilder()
        .limit({ amount: 10 })
        .costFilters({ Service: ["AmazonEC2"] })
        .build(stack, "FilteredBudget");

      Template.fromStack(stack).hasResourceProperties("AWS::Budgets::Budget", {
        Budget: Match.objectLike({
          CostFilters: { Service: ["AmazonEC2"] },
        }),
      });
    });
  });

  describe("validation", () => {
    it("throws when a COST budget has no limit", () => {
      const stack = newStack();

      expect(() => createBudgetBuilder().build(stack, "BadBudget")).toThrow(/limit\(/);
    });

    it("does not require a limit for RI_UTILIZATION budgets", () => {
      const stack = newStack();

      expect(() =>
        createBudgetBuilder().budgetType("RI_UTILIZATION").build(stack, "RiBudget"),
      ).not.toThrow();
    });

    it("throws when a percentage notification has no subscribers", () => {
      expect(() => createBudgetBuilder().notifyOnActual(80)).toThrow(/at least one subscriber/);
    });

    it("throws when withRecommendedThresholds() is called with no subscribers", () => {
      const stack = newStack();

      expect(() =>
        createBudgetBuilder()
          .limit({ amount: 10 })
          .withRecommendedThresholds()
          .build(stack, "RecommendedBudget"),
      ).toThrow(/at least one subscriber/);
    });
  });

  describe("email notifications", () => {
    it("emits an EMAIL subscriber for notifyOnActual", () => {
      const stack = newStack();
      createBudgetBuilder()
        .limit({ amount: 50 })
        .notifyOnActual(80, "ops@example.com")
        .build(stack, "EmailBudget");

      Template.fromStack(stack).hasResourceProperties("AWS::Budgets::Budget", {
        NotificationsWithSubscribers: [
          {
            Notification: {
              NotificationType: "ACTUAL",
              Threshold: 80,
              ComparisonOperator: "GREATER_THAN",
              ThresholdType: "PERCENTAGE",
            },
            Subscribers: [{ Address: "ops@example.com", SubscriptionType: "EMAIL" }],
          },
        ],
      });
    });

    it("emits FORECASTED notifications via notifyOnForecasted", () => {
      const stack = newStack();
      createBudgetBuilder()
        .limit({ amount: 50 })
        .notifyOnForecasted(100, "ops@example.com")
        .build(stack, "ForecastedBudget");

      Template.fromStack(stack).hasResourceProperties("AWS::Budgets::Budget", {
        NotificationsWithSubscribers: Match.arrayWith([
          Match.objectLike({
            Notification: Match.objectLike({
              NotificationType: "FORECASTED",
              Threshold: 100,
            }),
          }),
        ]),
      });
    });
  });

  describe("SNS subscribers", () => {
    it("creates a topic policy granting budgets.amazonaws.com SNS:Publish", () => {
      const stack = newStack();
      const topic = new Topic(stack, "AlertsTopic");

      createBudgetBuilder()
        .limit({ amount: 50 })
        .notifyOnActual(100, topic)
        .build(stack, "SnsBudget");

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::SNS::TopicPolicy", 1);
      template.hasResourceProperties("AWS::SNS::TopicPolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Principal: { Service: "budgets.amazonaws.com" },
              Action: "SNS:Publish",
            }),
          ]),
        }),
      });
    });

    it("deduplicates topic policies when the same topic is reused", () => {
      const stack = newStack();
      const topic = new Topic(stack, "AlertsTopic");

      const result = createBudgetBuilder()
        .limit({ amount: 50 })
        .notifyOnActual(80, topic)
        .notifyOnForecasted(100, topic)
        .build(stack, "DupSnsBudget");

      expect(Object.keys(result.topicPolicies)).toHaveLength(1);
      Template.fromStack(stack).resourceCountIs("AWS::SNS::TopicPolicy", 1);
    });

    it("resolves Resolvable<ITopic> subscribers via the build context", () => {
      const stack = newStack();
      const topic = new Topic(stack, "AlertsTopic");

      createBudgetBuilder()
        .limit({ amount: 50 })
        .notifyOnActual(100, ref<{ topic: Topic }>("alerts").get("topic"))
        .build(stack, "RefSnsBudget", { alerts: { topic } });

      Template.fromStack(stack).hasResourceProperties("AWS::Budgets::Budget", {
        NotificationsWithSubscribers: Match.arrayWith([
          Match.objectLike({
            Subscribers: [Match.objectLike({ SubscriptionType: "SNS" })],
          }),
        ]),
      });
    });
  });

  describe("withRecommendedThresholds", () => {
    it("adds ACTUAL@80% and FORECASTED@100% notifications", () => {
      const stack = newStack();
      createBudgetBuilder()
        .limit({ amount: 50 })
        .withRecommendedThresholds("ops@example.com")
        .build(stack, "RecBudget");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Budgets::Budget", {
        NotificationsWithSubscribers: Match.arrayWith([
          Match.objectLike({
            Notification: Match.objectLike({
              NotificationType: "ACTUAL",
              Threshold: 80,
            }),
          }),
          Match.objectLike({
            Notification: Match.objectLike({
              NotificationType: "FORECASTED",
              Threshold: 100,
            }),
          }),
        ]),
      });
    });
  });

  describe("addNotification", () => {
    it("accepts raw notification entries (e.g. ABSOLUTE_VALUE thresholds)", () => {
      const stack = newStack();
      createBudgetBuilder()
        .limit({ amount: 100 })
        .addNotification({
          notificationType: "ACTUAL",
          thresholdPercent: 120,
          thresholdType: "ABSOLUTE_VALUE",
          comparisonOperator: "GREATER_THAN",
          subscribers: ["oncall@example.com"],
        })
        .build(stack, "RawBudget");

      Template.fromStack(stack).hasResourceProperties("AWS::Budgets::Budget", {
        NotificationsWithSubscribers: Match.arrayWith([
          Match.objectLike({
            Notification: Match.objectLike({
              ThresholdType: "ABSOLUTE_VALUE",
              Threshold: 120,
            }),
          }),
        ]),
      });
    });
  });
});
