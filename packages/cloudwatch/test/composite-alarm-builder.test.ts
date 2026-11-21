import { describe, it, expect } from "vitest";
import { Duration, Tags } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Alarm, AlarmRule, AlarmState, CompositeAlarm, Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { combine, compose, ref, type Lifecycle } from "@composurecdk/core";
import { alarmName } from "../src/alarm-name.js";
import { createCompositeAlarmBuilder } from "../src/composite-alarm-builder.js";
import { alarmNamePolicy } from "../src/policies/alarm-name-policy.js";

function alarm(scope: IConstruct, id: string): Alarm {
  return new Alarm(scope, id, {
    metric: new Metric({ namespace: "Test", metricName: id }),
    threshold: 1,
    evaluationPeriods: 1,
  });
}

/** Whether the installed aws-cdk-lib renders tags on a composite alarm, probed by synthesis. */
function compositeAlarmsAreTaggable(): boolean {
  const probe = newStack();
  Tags.of(new CompositeAlarm(probe, "Probe", { alarmRule: alarm(probe, "Member") })).add("p", "1");
  const tagged = Template.fromStack(probe).findResources("AWS::CloudWatch::CompositeAlarm", {
    Properties: { Tags: Match.anyValue() },
  });
  return Object.keys(tagged).length > 0;
}

/** A component that builds one alarm, to stand in for a resource builder. */
function alarmComponent(): Lifecycle<{ alarm: Alarm }> {
  return { build: (scope, id) => ({ alarm: alarm(scope, id) }) };
}

/** A ref to an {@link alarmComponent}'s alarm. */
const alarmOf = (key: string) => ref(key, (r: { alarm: Alarm }) => r.alarm);

const buildAndSynth = buildFixture(createCompositeAlarmBuilder, "Rollback", {
  stackProps: { stackName: "payments-prod" },
  seed: (b, stack) => void b.alarmRule(alarm(stack, "Errors")),
});

describe("CompositeAlarmBuilder", () => {
  it("creates a composite alarm and returns it", () => {
    const { result, template } = buildAndSynth();

    template.resourceCountIs("AWS::CloudWatch::CompositeAlarm", 1);
    expect(result.alarm.node.id).toBe("Rollback");
  });

  it("names the alarm after its stack and id by default", () => {
    buildAndSynth().template.hasResourceProperties("AWS::CloudWatch::CompositeAlarm", {
      AlarmName: "payments-prod/rollback",
    });
  });

  it("uses an explicit name verbatim", () => {
    const { template } = buildAndSynth((b) => b.compositeAlarmName(alarmName("payments/rollback")));
    template.hasResourceProperties("AWS::CloudWatch::CompositeAlarm", {
      AlarmName: "payments/rollback",
    });
  });

  it("passes the rest of CDK's props through", () => {
    const { template } = buildAndSynth((b, stack) =>
      b
        .alarmDescription("Roll the deploy back.")
        .actionsEnabled(false)
        .actionsSuppressor(alarm(stack, "Maintenance"))
        .actionsSuppressorWaitPeriod(Duration.minutes(2))
        .actionsSuppressorExtensionPeriod(Duration.minutes(5)),
    );
    template.hasResourceProperties("AWS::CloudWatch::CompositeAlarm", {
      AlarmDescription: "Roll the deploy back.",
      ActionsEnabled: false,
      ActionsSuppressor: { "Fn::GetAtt": [Match.stringLikeRegexp("^Maintenance"), "Arn"] },
      ActionsSuppressorWaitPeriod: 120,
      ActionsSuppressorExtensionPeriod: 300,
    });
  });

  it("is tagged where CDK can tag a composite alarm", () => {
    const { template } = buildAndSynth((b) => b.tag("team", "payments"));
    // Below the aws-cdk-lib release that made AWS::CloudWatch::CompositeAlarm
    // taggable (above this package's floor), CDK's tag aspect skips it and the
    // tags are silently dropped (ADR-0008).
    template.hasResourceProperties("AWS::CloudWatch::CompositeAlarm", {
      Tags: compositeAlarmsAreTaggable() ? [{ Key: "team", Value: "payments" }] : Match.absent(),
    });
  });

  it("throws when alarmRule is not set", () => {
    expect(() => createCompositeAlarmBuilder().build(newStack(), "Rollback")).toThrow(
      /alarmRule is required/,
    );
  });

  it("combines alarms from other components in a composed system", () => {
    const stack = newStack();

    compose(
      {
        api: alarmComponent(),
        dlq: alarmComponent(),
        maintenance: alarmComponent(),
        rollback: createCompositeAlarmBuilder()
          .alarmRule(
            combine(
              {
                api: alarmOf("api"),
                dlq: alarmOf("dlq"),
              },
              ({ api, dlq }) =>
                AlarmRule.anyOf(api, AlarmRule.fromAlarm(dlq, AlarmState.INSUFFICIENT_DATA)),
            ),
          )
          .actionsSuppressor(alarmOf("maintenance")),
      },
      { api: [], dlq: [], maintenance: [], rollback: ["api", "dlq", "maintenance"] },
    ).build(stack, "Shop");

    const template = Template.fromStack(stack);
    const composites = Object.values(template.findResources("AWS::CloudWatch::CompositeAlarm"));
    expect(composites).toHaveLength(1);
    const props = JSON.stringify(composites[0].Properties);
    expect(props).toMatch(/ALARM\(.*Shopapi.*Arn/);
    expect(props).toMatch(/INSUFFICIENT_DATA\(.*Shopdlq.*Arn/);
    expect(props).toMatch(/ActionsSuppressor.*Shopmaintenance/);
  });

  it("is decorated by alarmNamePolicy's compositeOnly rules", () => {
    const { template } = buildAndSynth((_b, stack) => {
      alarmNamePolicy(stack, {
        rules: [{ match: () => true, compositeOnly: true, prefix: "prod" }],
      });
    });
    template.hasResourceProperties("AWS::CloudWatch::CompositeAlarm", {
      AlarmName: "prod-payments-prod/rollback",
    });
  });
});
