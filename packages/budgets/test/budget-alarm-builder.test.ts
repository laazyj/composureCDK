import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { type CfnBudget } from "aws-cdk-lib/aws-budgets";
import { compose, ref } from "@composurecdk/core";
import type { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createBudgetBuilder } from "../src/budget-builder.js";
import {
  createBudgetAlarmBuilder,
  type BudgetAlarmBuilderResult,
} from "../src/budget-alarm-builder.js";
import type { BudgetBuilderResult } from "../src/budget-builder.js";

const ACCOUNT = "123456789012";
const ENV_US_EAST_1 = { account: ACCOUNT, region: "us-east-1" };
const ENV_EU_WEST_2 = { account: ACCOUNT, region: "eu-west-2" };

function ec2EstimatedCharges(a: AlarmDefinitionBuilder<CfnBudget>) {
  return a
    .metric(
      () =>
        new Metric({
          namespace: "AWS/Billing",
          metricName: "EstimatedCharges",
          dimensionsMap: { Currency: "USD", ServiceName: "AmazonEC2" },
          statistic: "Maximum",
        }),
    )
    .threshold(500)
    .greaterThan();
}

function buildBudget(env = ENV_US_EAST_1) {
  const app = new App();
  const stack = new Stack(app, "TestStack", { env });
  const result = createBudgetBuilder()
    .budgetName("Account")
    .limit({ amount: 1000 })
    .recommendedAlarms(false)
    .build(stack, "AccountBudget");
  return { app, stack, result };
}

describe("createBudgetAlarmBuilder", () => {
  describe("with a concrete BudgetBuilderResult", () => {
    it("creates the recommended alarm in the alarm builder's scope", () => {
      const { stack, result } = buildBudget();
      const alarmResult = createBudgetAlarmBuilder()
        .budget(result)
        .recommendedAlarms({ estimatedCharges: { threshold: 1000 } })
        .build(stack, "Alarms");

      expect(alarmResult.alarms.estimatedCharges).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates no alarms when recommendedAlarms is left unset (off by default)", () => {
      const { stack, result } = buildBudget();
      const alarmResult = createBudgetAlarmBuilder().budget(result).build(stack, "Alarms");

      expect(alarmResult.alarms).toEqual({});
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("recommendedAlarms(false) suppresses the recommended alarm", () => {
      const { stack, result } = buildBudget();
      const alarmResult = createBudgetAlarmBuilder()
        .budget(result)
        .recommendedAlarms(false)
        .build(stack, "Alarms");

      expect(alarmResult.alarms).toEqual({});
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates custom addAlarm even when recommendedAlarms is unset", () => {
      const { stack, result } = buildBudget();
      const alarmResult = createBudgetAlarmBuilder()
        .budget(result)
        .addAlarm("ec2EstimatedCharges", ec2EstimatedCharges)
        .build(stack, "Alarms");

      expect(alarmResult.alarms.ec2EstimatedCharges).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates custom addAlarm alongside recommended alarms", () => {
      const { stack, result } = buildBudget();
      const alarmResult = createBudgetAlarmBuilder()
        .budget(result)
        .recommendedAlarms({ estimatedCharges: { threshold: 1000 } })
        .addAlarm("ec2EstimatedCharges", ec2EstimatedCharges)
        .build(stack, "Alarms");

      expect(alarmResult.alarms.ec2EstimatedCharges).toBeDefined();
      expect(alarmResult.alarms.estimatedCharges).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates the recommended alarm without calling .budget() (account-level metric)", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });
      const alarmResult = createBudgetAlarmBuilder()
        .recommendedAlarms({ estimatedCharges: { threshold: 1000 } })
        .build(stack, "Alarms");

      expect(alarmResult.alarms.estimatedCharges).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("throws when addAlarm() is used without .budget()", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });
      const builder = createBudgetAlarmBuilder().addAlarm(
        "ec2EstimatedCharges",
        ec2EstimatedCharges,
      );

      expect(() => builder.build(stack, "Alarms")).toThrow(/no budget/);
    });
  });

  describe("region warning", () => {
    function buildAlarmsInRegion(region: string | undefined): Stack {
      const app = new App();
      const budgetStackProps =
        region === undefined ? undefined : { env: ENV_EU_WEST_2, crossRegionReferences: true };
      const budgetStack = new Stack(app, "BudgetStack", budgetStackProps);
      const result = createBudgetBuilder()
        .budgetName("Account")
        .limit({ amount: 1000 })
        .recommendedAlarms(false)
        .build(budgetStack, "AccountBudget");

      const alarmStack =
        region === undefined
          ? new Stack(app, "AlarmStack")
          : new Stack(app, "AlarmStack", {
              env: { account: ACCOUNT, region },
              crossRegionReferences: true,
            });
      createBudgetAlarmBuilder()
        .budget(result)
        .recommendedAlarms({ estimatedCharges: { threshold: 1000 } })
        .build(alarmStack, "Alarms");
      return alarmStack;
    }

    it("emits a warning when the alarm stack is outside us-east-1", () => {
      const stack = buildAlarmsInRegion("us-west-2");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp('deployed in "us-west-2"'),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("emits no warning when the alarm stack is in us-east-1", () => {
      const stack = buildAlarmsInRegion("us-east-1");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("AWS/Billing EstimatedCharges"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("emits no warning when the alarm stack region is an unresolved token", () => {
      const stack = buildAlarmsInRegion(undefined);
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("AWS/Billing EstimatedCharges"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("warns on the custom-alarm-only path outside us-east-1", () => {
      const app = new App();
      const budgetStack = new Stack(app, "BudgetStack", {
        env: ENV_EU_WEST_2,
        crossRegionReferences: true,
      });
      const result = createBudgetBuilder()
        .budgetName("Account")
        .limit({ amount: 1000 })
        .recommendedAlarms(false)
        .build(budgetStack, "AccountBudget");

      const alarmStack = new Stack(app, "AlarmStack", {
        env: { account: ACCOUNT, region: "us-west-2" },
        crossRegionReferences: true,
      });
      createBudgetAlarmBuilder()
        .budget(result)
        .addAlarm("ec2EstimatedCharges", ec2EstimatedCharges)
        .build(alarmStack, "Alarms");

      const warnings = Annotations.fromStack(alarmStack).findWarning(
        "*",
        Match.stringLikeRegexp('deployed in "us-west-2"'),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("with a Ref<BudgetBuilderResult> through compose", () => {
    it("resolves the budget and creates the same alarm surface", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });

      const system = compose(
        {
          account: createBudgetBuilder()
            .budgetName("Account")
            .limit({ amount: 1000 })
            .recommendedAlarms(false),

          accountAlarms: createBudgetAlarmBuilder()
            .budget(ref<BudgetBuilderResult>("account"))
            .recommendedAlarms({ estimatedCharges: { threshold: 1000 } }),
        },
        { account: [], accountAlarms: ["account"] },
      );

      const result = system.build(stack, "Test") as {
        account: BudgetBuilderResult;
        accountAlarms: BudgetAlarmBuilderResult;
      };

      expect(result.account.alarms).toEqual({});
      expect(result.accountAlarms.alarms.estimatedCharges).toBeDefined();

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Budgets::Budget", 1);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("routes alarms into a separate stack via withStacks()", () => {
      const app = new App();
      const appStack = new Stack(app, "AppStack", {
        env: ENV_EU_WEST_2,
        crossRegionReferences: true,
      });
      const alarmStack = new Stack(app, "AlarmStack", {
        env: ENV_US_EAST_1,
        crossRegionReferences: true,
      });

      compose(
        {
          account: createBudgetBuilder()
            .budgetName("Account")
            .limit({ amount: 1000 })
            .recommendedAlarms(false),

          accountAlarms: createBudgetAlarmBuilder()
            .budget(ref<BudgetBuilderResult>("account"))
            .recommendedAlarms({ estimatedCharges: { threshold: 1000 } }),
        },
        { account: [], accountAlarms: ["account"] },
      )
        .withStacks({
          account: appStack,
          accountAlarms: alarmStack,
        })
        .build(app, "MultiRegion");

      const appTemplate = Template.fromStack(appStack);
      const alarmTemplate = Template.fromStack(alarmStack);

      appTemplate.resourceCountIs("AWS::Budgets::Budget", 1);
      appTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 0);

      alarmTemplate.resourceCountIs("AWS::Budgets::Budget", 0);
      alarmTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 1);

      const warnings = Annotations.fromStack(alarmStack).findWarning(
        "*",
        Match.stringLikeRegexp("AWS/Billing EstimatedCharges"),
      );
      expect(warnings).toHaveLength(0);
    });
  });
});
