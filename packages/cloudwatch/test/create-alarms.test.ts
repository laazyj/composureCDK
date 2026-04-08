import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Template } from "aws-cdk-lib/assertions";
import { createAlarms } from "../src/create-alarms.js";
import type { AlarmDefinition } from "../src/alarm-definition.js";

function makeDefinition(overrides: Partial<AlarmDefinition> & { key: string }): AlarmDefinition {
  return {
    metric: new Metric({ namespace: "Test", metricName: "Count", period: Duration.minutes(1) }),
    threshold: 0,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
    description: "Test alarm",
    ...overrides,
  };
}

describe("createAlarms", () => {
  it("creates CDK alarms from definitions", () => {
    const stack = new Stack(new App(), "TestStack");
    const definitions = [makeDefinition({ key: "errors" }), makeDefinition({ key: "throttles" })];

    const result = createAlarms(stack, "MyFunc", definitions);
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    expect(Object.keys(result)).toEqual(["errors", "throttles"]);
  });

  it("returns record with correct keys", () => {
    const stack = new Stack(new App(), "TestStack");
    const definitions = [
      makeDefinition({ key: "errors" }),
      makeDefinition({ key: "concurrentExecutions" }),
    ];

    const result = createAlarms(stack, "Fn", definitions);

    expect(result.errors).toBeDefined();
    expect(result.concurrentExecutions).toBeDefined();
  });

  it("returns empty record for empty definitions", () => {
    const stack = new Stack(new App(), "TestStack");

    const result = createAlarms(stack, "Fn", []);
    const template = Template.fromStack(stack);

    expect(result).toEqual({});
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("uses capitalize(key) + Alarm suffix for construct IDs", () => {
    const stack = new Stack(new App(), "TestStack");
    const definitions = [makeDefinition({ key: "errors" })];

    createAlarms(stack, "MyFunc", definitions);
    const template = Template.fromStack(stack);

    // The construct ID "MyFuncErrorsAlarm" should appear in the logical ID
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    const logicalIds = Object.keys(alarms);
    expect(logicalIds.some((id) => id.startsWith("MyFuncErrorsAlarm"))).toBe(true);
  });

  it("applies all definition properties to the alarm", () => {
    const stack = new Stack(new App(), "TestStack");
    const definitions = [
      makeDefinition({
        key: "custom",
        threshold: 42,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 5,
        datapointsToAlarm: 3,
        treatMissingData: TreatMissingData.BREACHING,
        description: "Custom alarm description",
      }),
    ];

    createAlarms(stack, "Fn", definitions);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 42,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      EvaluationPeriods: 5,
      DatapointsToAlarm: 3,
      TreatMissingData: "breaching",
      AlarmDescription: "Custom alarm description",
    });
  });
});
