import { describe, it, expect } from "vitest";
import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { AlarmDefinitionBuilder } from "../src/alarm-definition-builder.js";

describe("AlarmDefinitionBuilder", () => {
  it("produces a correct definition with all fields set", () => {
    const metric = new Metric({
      namespace: "Test",
      metricName: "Count",
      period: Duration.minutes(1),
    });

    const definition = new AlarmDefinitionBuilder<string>("myAlarm")
      .metric(() => metric)
      .threshold(10)
      .greaterThanOrEqual()
      .evaluationPeriods(3)
      .datapointsToAlarm(2)
      .treatMissingData(TreatMissingData.BREACHING)
      .description("Test alarm description")
      .resolve("unused");

    expect(definition).toEqual({
      key: "myAlarm",
      metric,
      threshold: 10,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      treatMissingData: TreatMissingData.BREACHING,
      description: "Test alarm description",
    });
  });

  it("applies sensible defaults", () => {
    const metric = new Metric({ namespace: "Test", metricName: "Count" });

    const definition = new AlarmDefinitionBuilder<string>("defaults")
      .metric(() => metric)
      .resolve("unused");

    expect(definition.threshold).toBe(0);
    expect(definition.comparisonOperator).toBe(ComparisonOperator.GREATER_THAN_THRESHOLD);
    expect(definition.evaluationPeriods).toBe(1);
    expect(definition.datapointsToAlarm).toBe(1);
    expect(definition.treatMissingData).toBe(TreatMissingData.NOT_BREACHING);
    expect(definition.description).toBe("");
  });

  it("passes the construct to the metric factory", () => {
    const metric = new Metric({ namespace: "Test", metricName: "Count" });
    let receivedConstruct: string | undefined;

    new AlarmDefinitionBuilder<string>("test")
      .metric((construct) => {
        receivedConstruct = construct;
        return metric;
      })
      .resolve("myConstruct");

    expect(receivedConstruct).toBe("myConstruct");
  });

  it("throws when metric is not set before resolve", () => {
    const builder = new AlarmDefinitionBuilder<string>("noMetric");

    expect(() => builder.resolve("unused")).toThrow(
      'AlarmDefinitionBuilder "noMetric": metric() must be called before resolve()',
    );
  });

  it("supports chaining all methods", () => {
    const metric = new Metric({ namespace: "Test", metricName: "Count" });

    const builder = new AlarmDefinitionBuilder<string>("chain")
      .metric(() => metric)
      .threshold(5)
      .greaterThan()
      .evaluationPeriods(2)
      .datapointsToAlarm(1)
      .treatMissingData(TreatMissingData.MISSING)
      .description("chained");

    expect(builder).toBeInstanceOf(AlarmDefinitionBuilder);
    expect(builder.resolve("unused").key).toBe("chain");
  });

  it("supports a description factory that receives the resolved definition", () => {
    const metric = new Metric({
      namespace: "Test",
      metricName: "Count",
      period: Duration.minutes(1),
    });

    const definition = new AlarmDefinitionBuilder<string>("factory")
      .metric(() => metric)
      .threshold(42)
      .greaterThanOrEqual()
      .description((def) => `Alert when count >= ${String(def.threshold)}`)
      .resolve("unused");

    expect(definition.description).toBe("Alert when count >= 42");
  });

  it("supports all comparison operators", () => {
    const metric = new Metric({ namespace: "Test", metricName: "Count" });
    const builder = () => new AlarmDefinitionBuilder<string>("op").metric(() => metric);

    expect(builder().lessThan().resolve("x").comparisonOperator).toBe(
      ComparisonOperator.LESS_THAN_THRESHOLD,
    );
    expect(builder().lessThanOrEqual().resolve("x").comparisonOperator).toBe(
      ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
    );
    expect(builder().greaterThan().resolve("x").comparisonOperator).toBe(
      ComparisonOperator.GREATER_THAN_THRESHOLD,
    );
    expect(builder().greaterThanOrEqual().resolve("x").comparisonOperator).toBe(
      ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    );
  });
});
