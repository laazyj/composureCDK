import { describe, expect, it } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createReputationAlarmBuilder } from "../src/reputation-alarm-builder.js";
import { resolveReputationAlarmDefinitions } from "../src/reputation-alarms.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack", {
    env: { account: "111111111111", region: "us-east-1" },
  });
}

/** A target-less custom alarm on the SES `Reject` count, for reuse in tests. */
function rejectAlarm(a: AlarmDefinitionBuilder<void>): AlarmDefinitionBuilder<void> {
  return a
    .metric(
      () =>
        new Metric({
          namespace: "AWS/SES",
          metricName: "Reject",
          statistic: "Sum",
          period: Duration.minutes(5),
        }),
    )
    .threshold(1)
    .greaterThan()
    .description("SES rejected a message.");
}

describe("ReputationAlarmBuilder", () => {
  it("creates bounce and complaint rate alarms with AWS-recommended thresholds", () => {
    const stack = newStack();
    const { alarms } = createReputationAlarmBuilder().build(stack, "SesReputation");

    expect(Object.keys(alarms).sort()).toEqual(["bounceRate", "complaintRate"]);
    const t = Template.fromStack(stack);
    t.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Reputation.BounceRate",
      Namespace: "AWS/SES",
      Threshold: 0.05,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      TreatMissingData: "ignore",
      Statistic: "Average",
      Period: 3600,
    });
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Reputation.ComplaintRate",
      Threshold: 0.001,
    });
  });

  it("emits the reputation metrics without dimensions (account-scoped)", () => {
    const stack = newStack();
    createReputationAlarmBuilder().build(stack, "SesReputation");
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Reputation.BounceRate",
      Dimensions: Match.absent(),
    });
  });

  it("disables the recommended alarms when recommendedAlarms is false", () => {
    const stack = newStack();
    const { alarms } = createReputationAlarmBuilder()
      .recommendedAlarms(false)
      .build(stack, "SesReputation");
    expect(alarms).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("keeps custom alarms when the recommended alarms are disabled with false", () => {
    const stack = newStack();
    const { alarms } = createReputationAlarmBuilder()
      .recommendedAlarms(false)
      .addAlarm("rejects", rejectAlarm)
      .build(stack, "SesReputation");
    // recommendedAlarms(false) suppresses only the recommended set — the
    // explicitly-added custom alarm must survive.
    expect(Object.keys(alarms)).toEqual(["rejects"]);
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps custom alarms when the recommended alarms are disabled with enabled:false", () => {
    const stack = newStack();
    const { alarms } = createReputationAlarmBuilder()
      .recommendedAlarms({ enabled: false })
      .addAlarm("rejects", rejectAlarm)
      .build(stack, "SesReputation");
    expect(Object.keys(alarms)).toEqual(["rejects"]);
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("disables only the bounce-rate alarm", () => {
    const stack = newStack();
    const { alarms } = createReputationAlarmBuilder()
      .recommendedAlarms({ bounceRate: false })
      .build(stack, "SesReputation");
    expect(Object.keys(alarms)).toEqual(["complaintRate"]);
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("disables a single alarm and tunes the other's threshold", () => {
    const stack = newStack();
    createReputationAlarmBuilder()
      .recommendedAlarms({ complaintRate: false, bounceRate: { threshold: 0.08 } })
      .build(stack, "SesReputation");
    const t = Template.fromStack(stack);
    t.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Reputation.BounceRate",
      Threshold: 0.08,
    });
  });

  it("disables all alarms via the config enabled switch", () => {
    const stack = newStack();
    const { alarms } = createReputationAlarmBuilder()
      .recommendedAlarms({ enabled: false })
      .build(stack, "SesReputation");
    expect(alarms).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("copies accumulated custom alarms on .copy()", () => {
    const stack = newStack();
    const base = createReputationAlarmBuilder().addAlarm("rejects", rejectAlarm);
    const { alarms } = base.copy().build(stack, "SesReputation");
    expect(alarms.rejects).toBeDefined();
  });

  it("adds a custom alarm alongside the recommended ones", () => {
    const stack = newStack();
    const { alarms } = createReputationAlarmBuilder()
      .addAlarm("rejects", rejectAlarm)
      .build(stack, "SesReputation");

    expect(alarms.rejects).toBeDefined();
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 3);
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Reject",
    });
  });
});

describe("resolveReputationAlarmDefinitions", () => {
  it("returns no definitions when disabled via the enabled switch", () => {
    expect(resolveReputationAlarmDefinitions({ enabled: false })).toEqual([]);
  });

  it("returns both recommended definitions by default", () => {
    expect(resolveReputationAlarmDefinitions(undefined).map((d) => d.key)).toEqual([
      "bounceRate",
      "complaintRate",
    ]);
  });
});
