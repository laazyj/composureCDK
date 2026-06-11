import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { resolveAlarmThresholdBasis } from "../src/alarm-threshold-basis.js";

function testScope() {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  return { stack };
}

const WARNING_ID = "@composurecdk/test:token-threshold";

describe("resolveAlarmThresholdBasis", () => {
  it("returns the resolved basis for a concrete value", () => {
    const { stack } = testScope();

    const basis = resolveAlarmThresholdBasis({
      scope: stack,
      value: 100,
      resolve: (n) => n,
      warningId: WARNING_ID,
      alarmLabel: "test",
      suppressHint: "recommendedAlarms({ test: false })",
    });

    expect(basis).toBe(100);
    expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
  });

  it("applies the resolve conversion to a concrete value", () => {
    const { stack } = testScope();

    const basis = resolveAlarmThresholdBasis({
      scope: stack,
      value: Duration.seconds(30),
      isUnresolved: (d) => d.isUnresolved(),
      resolve: (d) => d.toMilliseconds(),
      warningId: WARNING_ID,
      alarmLabel: "test",
      suppressHint: "recommendedAlarms({ test: false })",
    });

    expect(basis).toBe(30_000);
  });

  it("returns undefined without warning for an unconfigured (undefined) value", () => {
    const { stack } = testScope();

    const basis = resolveAlarmThresholdBasis({
      scope: stack,
      value: undefined,
      resolve: (n: number) => n,
      warningId: WARNING_ID,
      alarmLabel: "test",
      suppressHint: "recommendedAlarms({ test: false })",
    });

    expect(basis).toBeUndefined();
    expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
  });

  it("skips and warns for a token-valued number (default Token.isUnresolved guard)", () => {
    const { stack } = testScope();
    const param = new CfnParameter(stack, "Concurrency", { type: "Number", default: 100 });

    const basis = resolveAlarmThresholdBasis({
      scope: stack,
      value: param.valueAsNumber,
      resolve: (n) => n,
      warningId: WARNING_ID,
      alarmLabel: "test concurrency",
      suppressHint: "recommendedAlarms({ test: false })",
    });

    expect(basis).toBeUndefined();
    Annotations.fromStack(stack).hasWarning(
      "*",
      Match.stringLikeRegexp(
        "Skipping the recommended test concurrency alarm.*" +
          "recommendedAlarms\\(\\{ test: false \\}\\).*" +
          `\\[ack: ${WARNING_ID}\\]`,
      ),
    );
  });

  it("skips and warns for a token-valued Duration via the custom guard", () => {
    const { stack } = testScope();
    const param = new CfnParameter(stack, "TimeoutSeconds", { type: "Number", default: 30 });

    // toMilliseconds() throws on a token-valued seconds Duration; the guard must
    // short-circuit before resolve() is ever called.
    const basis = resolveAlarmThresholdBasis({
      scope: stack,
      value: Duration.seconds(param.valueAsNumber),
      isUnresolved: (d) => d.isUnresolved(),
      resolve: (d) => d.toMilliseconds(),
      warningId: WARNING_ID,
      alarmLabel: "test duration",
      suppressHint: "recommendedAlarms({ test: false })",
    });

    expect(basis).toBeUndefined();
    Annotations.fromStack(stack).hasWarning(
      "*",
      Match.stringLikeRegexp(
        `Skipping the recommended test duration alarm.*\\[ack: ${WARNING_ID}\\]`,
      ),
    );
  });
});
