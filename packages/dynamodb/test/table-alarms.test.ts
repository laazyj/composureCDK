import { describe, it, expect } from "vitest";
import { type Lifecycle } from "@composurecdk/core";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { createTableBuilder, type ITableBuilder } from "../src/table-builder.js";
import { createTableV2Builder, type ITableV2Builder } from "../src/table-v2-builder.js";
import { resolveTableAlarmDefinitions } from "../src/table-alarms.js";

const PK = { name: "pk", type: AttributeType.STRING };

// The alarm path is shared between both builders (createTableAlarms is typed to
// ITable, which TableV2 also satisfies). Parametrise every assertion over both
// factories to prove the recommended alarms, customisation, and custom-alarm
// hooks behave identically regardless of which construct backs the table.
const builders = [
  { name: "createTableBuilder", create: createTableBuilder },
  { name: "createTableV2Builder", create: createTableV2Builder },
] as const;

type AnyTableBuilder = ITableBuilder | ITableV2Builder;

describe.each(builders)("$name table alarms", ({ create }) => {
  function build(configureFn?: (builder: AnyTableBuilder) => void): {
    result: { alarms: Record<string, unknown> };
    template: Template;
  } {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const builder = create().partitionKey(PK);
    configureFn?.(builder);
    // `builder` is a union of the two builder types, so `.build()` is a union of
    // two call signatures. typescript-eslint's project service can intermittently
    // fail to resolve that union (the file is the only test importing both
    // builders), degrading it to an `error` type and tripping no-unsafe-call —
    // flaky across the Node CI matrix. Both builders implement Lifecycle and
    // every result carries `alarms`, so widen to that single signature.
    const result = (builder as Lifecycle<{ alarms: Record<string, unknown> }>).build(
      stack,
      "TestTable",
    );
    return { result, template: Template.fromStack(stack) };
  }

  describe("recommended alarms", () => {
    it("creates the three recommended alarms by default", () => {
      const { result, template } = build();

      expect(Object.keys(result.alarms).sort()).toEqual([
        "readThrottleEvents",
        "systemErrors",
        "writeThrottleEvents",
      ]);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("alarms on read throttle events with a > 0 threshold", () => {
      const { template } = build();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ReadThrottleEvents",
        Namespace: "AWS/DynamoDB",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });

    it("alarms on write throttle events with a > 0 threshold", () => {
      const { template } = build();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "WriteThrottleEvents",
        Namespace: "AWS/DynamoDB",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });

    it("alarms on system errors via a math expression across operations", () => {
      const { template } = build();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Metrics: Match.arrayWith([Match.objectLike({ Expression: Match.anyValue() })]),
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });
  });

  describe("customizing and disabling", () => {
    it("disables all recommended alarms when recommendedAlarms is false", () => {
      const { result, template } = build((b) => b.recommendedAlarms(false));

      expect(Object.keys(result.alarms)).toHaveLength(0);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all recommended alarms when enabled is false", () => {
      const { result } = build((b) => b.recommendedAlarms({ enabled: false }));

      expect(Object.keys(result.alarms)).toHaveLength(0);
    });

    it("disables an individual alarm", () => {
      const { result } = build((b) => b.recommendedAlarms({ writeThrottleEvents: false }));

      expect(Object.keys(result.alarms).sort()).toEqual(["readThrottleEvents", "systemErrors"]);
    });

    it("overrides an individual alarm threshold", () => {
      const { template } = build((b) =>
        b.recommendedAlarms({ readThrottleEvents: { threshold: 10, evaluationPeriods: 3 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ReadThrottleEvents",
        Threshold: 10,
        EvaluationPeriods: 3,
      });
    });
  });

  describe("custom alarms", () => {
    it("creates a custom alarm alongside the recommended ones", () => {
      const { result, template } = build((b) =>
        b.addAlarm("userErrors", (a) =>
          a
            .metric((table) => table.metricUserErrors({ period: Duration.minutes(5) }))
            .threshold(5)
            .greaterThan()
            .description("Table is returning client-side (HTTP 400) errors."),
        ),
      );

      expect(result.alarms.userErrors).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "UserErrors",
        Namespace: "AWS/DynamoDB",
        Threshold: 5,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });

    // Regression: disabling the recommended alarms must not drop custom alarms
    // added via addAlarm() — see issue #305.
    it("keeps a custom alarm when recommendedAlarms is false", () => {
      const { result, template } = build((b) => {
        b.recommendedAlarms(false);
        b.addAlarm("userErrors", (a) =>
          a
            .metric((table) => table.metricUserErrors({ period: Duration.minutes(5) }))
            .threshold(5)
            .greaterThan()
            .description("Table is returning client-side (HTTP 400) errors."),
        );
      });

      expect(result.alarms.userErrors).toBeDefined();
      expect(Object.keys(result.alarms)).toEqual(["userErrors"]);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
      const { result, template } = build((b) => {
        b.recommendedAlarms({ enabled: false });
        b.addAlarm("userErrors", (a) =>
          a
            .metric((table) => table.metricUserErrors({ period: Duration.minutes(5) }))
            .threshold(5)
            .greaterThan()
            .description("Table is returning client-side (HTTP 400) errors."),
        );
      });

      expect(result.alarms.userErrors).toBeDefined();
      expect(Object.keys(result.alarms)).toEqual(["userErrors"]);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });
  });
});

describe("resolveTableAlarmDefinitions", () => {
  it("returns no definitions when explicitly disabled", () => {
    const stack = new Stack(new App(), "TestStack");
    const table = new Table(stack, "Table", { partitionKey: PK });

    expect(resolveTableAlarmDefinitions(table, { enabled: false })).toEqual([]);
  });
});
