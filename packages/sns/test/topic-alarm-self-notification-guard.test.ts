import { describe, it, expect } from "vitest";
import { Annotations as CdkAnnotations, type Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { MathExpression } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { type ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { newStack } from "@composurecdk/cdk-testing";
import { createTopicBuilder } from "../src/topic-builder.js";
import { TOPIC_ALARM_SELF_NOTIFICATION_WARNING_ID } from "../src/topic-alarm-self-notification-guard.js";

function warnings(stack: Stack) {
  return Annotations.fromStack(stack).findWarning(
    "*",
    Match.stringLikeRegexp('alarm "numberOfNotificationsFailed" notifies the topic it watches'),
  );
}

/** Routes every alarm in the stack to `topic`, as an alert topic's app does. */
function notify(stack: Stack, topic: ITopic) {
  alarmActionsPolicy(stack, { defaults: { alarmActions: [new SnsAction(topic)] } });
}

describe("alarm self-notification guard", () => {
  it("warns when a stack-wide alarmActionsPolicy sends a topic's alarms to itself", () => {
    const stack = newStack();
    notify(stack, createTopicBuilder().build(stack, "Alerts").topic);

    expect(warnings(stack)).toHaveLength(1);
  });

  it("warns when the action is added to the alarm directly", () => {
    const stack = newStack();
    const { topic, alarms } = createTopicBuilder().build(stack, "Alerts");
    alarms.numberOfNotificationsFailed?.addAlarmAction(new SnsAction(topic));

    expect(warnings(stack)).toHaveLength(1);
  });

  it("stays quiet when the alarms notify a different topic", () => {
    const stack = newStack();
    createTopicBuilder().build(stack, "Orders");
    notify(stack, new Topic(stack, "Ops"));

    expect(warnings(stack)).toEqual([]);
  });

  it("warns for a custom alarm on a delivery-failure metric", () => {
    const stack = newStack();
    const { topic } = createTopicBuilder()
      .recommendedAlarms(false)
      .addAlarm("numberOfNotificationsFailed", (alarm) =>
        alarm.metric((t) => t.metricNumberOfNotificationsFailed()).threshold(10),
      )
      .build(stack, "Alerts");
    notify(stack, topic);

    expect(warnings(stack)).toHaveLength(1);
  });

  it("stays quiet for an alarm on another metric", () => {
    const stack = newStack();
    const { topic } = createTopicBuilder()
      .recommendedAlarms({ numberOfNotificationsFilteredOutInvalidAttributes: {} })
      .addAlarm("published", (alarm) =>
        alarm.metric((t) => t.metricNumberOfMessagesPublished()).threshold(10),
      )
      .build(stack, "Alerts");
    notify(stack, topic);

    expect(
      Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp("notifies the topic")),
    ).toHaveLength(1); // numberOfNotificationsFailed only
  });

  it("stays quiet for a metric-math alarm, which names no single metric", () => {
    const stack = newStack();
    const { topic } = createTopicBuilder()
      .recommendedAlarms(false)
      .addAlarm("failureRate", (alarm) =>
        alarm
          .metric(
            (t) =>
              new MathExpression({
                expression: "failed / published",
                usingMetrics: {
                  failed: t.metricNumberOfNotificationsFailed(),
                  published: t.metricNumberOfMessagesPublished(),
                },
              }),
          )
          .threshold(0.1),
      )
      .build(stack, "Alerts");
    notify(stack, topic);

    expect(warnings(stack)).toEqual([]);
  });

  it("is silenced by acknowledging the warning on the stack", () => {
    const stack = newStack();
    notify(stack, createTopicBuilder().build(stack, "Alerts").topic);
    CdkAnnotations.of(stack).acknowledgeWarning(TOPIC_ALARM_SELF_NOTIFICATION_WARNING_ID);

    expect(warnings(stack)).toEqual([]);
  });
});
