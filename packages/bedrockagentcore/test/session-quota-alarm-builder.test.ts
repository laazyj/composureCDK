import { describe, expect, it } from "vitest";
import { CfnParameter } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { buildFixture } from "@composurecdk/cdk-testing";
import { createSessionQuotaAlarmBuilder } from "../src/session-quota-alarm-builder.js";

const buildAndSynth = buildFixture(createSessionQuotaAlarmBuilder, "Sessions");

describe("createSessionQuotaAlarmBuilder", () => {
  it("creates no alarms unless a quota is supplied", () => {
    const { result } = buildAndSynth();

    expect(result.alarms).toEqual({});
  });

  it("alarms at each quota's threshold, 80% by default", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms({
        runtime: { quota: 2500 },
        codeInterpreter: { quota: 1000, thresholdPercent: 0.5 },
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["runtime", "codeInterpreter"]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Bedrock-AgentCore",
      MetricName: "ActiveSessionCount",
      Dimensions: [{ Name: "Service", Value: "AgentCore.Runtime" }],
      Statistic: "Maximum",
      Period: 60,
      Threshold: 2000,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Dimensions: [{ Name: "Service", Value: "AgentCore.CodeInterpreter" }],
      Threshold: 500,
    });
  });

  it("warns and skips an alarm whose quota is a token", () => {
    const { result, stack } = buildAndSynth((b, s) =>
      b.recommendedAlarms({
        browser: { quota: new CfnParameter(s, "Quota", { type: "Number" }).valueAsNumber },
      }),
    );

    expect(result.alarms).toEqual({});
    Annotations.fromStack(stack).hasWarning(
      "*",
      Match.stringLikeRegexp(
        "AgentCore.Browser session quota.*recommendedAlarms\\(\\{ browser: false \\}\\)",
      ),
    );
  });

  it.each([
    [{ quota: 0 }, /quota must be a positive number/],
    [{ quota: 10, thresholdPercent: 1.5 }, /thresholdPercent must be in/],
  ])("rejects %o", (runtime, message) => {
    expect(() => buildAndSynth((b) => b.recommendedAlarms({ runtime }))).toThrow(message);
  });

  it("skips a disabled alarm", () => {
    const { result } = buildAndSynth((b) => b.recommendedAlarms({ runtime: false }));

    expect(result.alarms).toEqual({});
  });
});
