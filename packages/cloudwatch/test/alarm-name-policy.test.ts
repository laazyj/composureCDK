import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Template } from "aws-cdk-lib/assertions";
import { alarmName } from "../src/alarm-name.js";
import { alarmNamePolicy } from "../src/policies/alarm-name-policy.js";

function makeMetric(): Metric {
  return new Metric({ namespace: "Test", metricName: "Count", period: Duration.minutes(1) });
}

function makeAlarm(scope: Stack, id: string, name?: string): Alarm {
  return new Alarm(scope, id, {
    alarmName: name ?? id,
    metric: makeMetric(),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
}

function alarmNamesByLogicalId(template: Template): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [logicalId, resource] of Object.entries(
    template.findResources("AWS::CloudWatch::Alarm"),
  )) {
    const props = (resource as { Properties: { AlarmName?: string } }).Properties;
    if (props.AlarmName !== undefined) out[logicalId] = props.AlarmName;
  }
  return out;
}

describe("alarmNamePolicy", () => {
  it("applies defaults.prefix to every alarm name", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "Errors", "stack/svc/errors");
    makeAlarm(stack, "Throttles", "stack/svc/throttles");

    alarmNamePolicy(app, { defaults: { prefix: "prod" } });

    const names = alarmNamesByLogicalId(Template.fromStack(stack));
    for (const name of Object.values(names)) {
      expect(name.startsWith("prod-")).toBe(true);
    }
  });

  it("applies defaults.suffix", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "Errors", "stack/svc/errors");

    alarmNamePolicy(app, { defaults: { suffix: "v1" } });

    const names = alarmNamesByLogicalId(Template.fromStack(stack));
    expect(Object.values(names)).toContain("stack/svc/errors-v1");
  });

  it("layers matching rule decoration on top of defaults", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "Errors", "stack/svc/errors");
    makeAlarm(stack, "Throttles", "stack/svc/throttles");

    alarmNamePolicy(app, {
      defaults: { prefix: "prod" },
      rules: [{ match: "Errors", suffix: "critical" }],
    });

    const names = alarmNamesByLogicalId(Template.fromStack(stack));
    expect(Object.values(names)).toContain("prod-stack/svc/errors-critical");
    expect(Object.values(names)).toContain("prod-stack/svc/throttles");
  });

  it("supports a custom separator", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "Errors", "stack/svc/errors");

    alarmNamePolicy(app, { defaults: { prefix: "prod" }, separator: "_" });

    const names = alarmNamesByLogicalId(Template.fromStack(stack));
    expect(Object.values(names)).toContain("prod_stack/svc/errors");
  });

  it("transform replaces the current name and wins over prefix/suffix on the same rule", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "Errors", "stack/svc/errors");

    alarmNamePolicy(app, {
      defaults: { prefix: "prod" },
      rules: [
        {
          match: "Errors",
          prefix: "ignored",
          suffix: "ignored",
          transform: (ctx) => alarmName(`${ctx.currentName}-payments`),
        },
      ],
    });

    const names = alarmNamesByLogicalId(Template.fromStack(stack));
    expect(Object.values(names)).toContain("prod-stack/svc/errors-payments");
  });

  it("replaceDefaults: true skips the default decoration for matched alarms", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "Errors", "stack/svc/errors");
    makeAlarm(stack, "Throttles", "stack/svc/throttles");

    alarmNamePolicy(app, {
      defaults: { prefix: "prod" },
      rules: [{ match: "Errors", prefix: "team-x", replaceDefaults: true }],
    });

    const names = alarmNamesByLogicalId(Template.fromStack(stack));
    expect(Object.values(names)).toContain("team-x-stack/svc/errors");
    expect(Object.values(names)).toContain("prod-stack/svc/throttles");
  });

  it("matches via regex against path", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "PaymentsErrors", "stack/svc/errors");
    makeAlarm(stack, "OrdersErrors", "stack/svc/errors-orders");

    alarmNamePolicy(app, {
      rules: [{ match: /Payments/, suffix: "critical" }],
    });

    const names = alarmNamesByLogicalId(Template.fromStack(stack));
    const paymentsName = Object.entries(names).find(([id]) => id.startsWith("PaymentsErrors"))?.[1];
    const ordersName = Object.entries(names).find(([id]) => id.startsWith("OrdersErrors"))?.[1];
    expect(paymentsName).toBe("stack/svc/errors-critical");
    expect(ordersName).toBe("stack/svc/errors-orders");
  });

  it("ignores alarms with no AlarmName set", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new Alarm(stack, "NoName", {
      metric: makeMetric(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    alarmNamePolicy(app, { defaults: { prefix: "prod" } });

    // No throw, no name set.
    const template = Template.fromStack(stack);
    for (const resource of Object.values(template.findResources("AWS::CloudWatch::Alarm"))) {
      const props = (resource as { Properties: { AlarmName?: string } }).Properties;
      expect(props.AlarmName).toBeUndefined();
    }
  });

  it("throws when the resulting name has invalid characters", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    makeAlarm(stack, "Errors", "stack/svc/errors");

    alarmNamePolicy(app, { defaults: { suffix: "bad!suffix" } });

    expect(() => Template.fromStack(stack)).toThrow(/invalid characters/);
  });
});
