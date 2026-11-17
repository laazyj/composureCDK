import { Annotations, Aspects, Stack } from "aws-cdk-lib";
import type { Alarm, CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";

/**
 * Suppression id for the warning raised when one of a topic's recommended
 * alarms notifies the topic it watches. Stable and part of the public surface:
 * silence it with
 * `Annotations.of(scope).acknowledgeWarning(TOPIC_ALARM_SELF_NOTIFICATION_WARNING_ID)`,
 * where `scope` is an ancestor of the alarm, such as its stack.
 */
export const TOPIC_ALARM_SELF_NOTIFICATION_WARNING_ID =
  "@composurecdk/sns:alarm-notifies-own-topic";

/**
 * The SNS metrics that count notifications SNS failed to deliver. An alarm on
 * one of them cannot usefully notify the topic it measures.
 */
const DELIVERY_FAILURE_METRICS = new Set([
  "NumberOfNotificationsFailed",
  "NumberOfNotificationsRedrivenToDlq",
  "NumberOfNotificationsFailedToRedriveToDlq",
]);

/**
 * Warns when an alarm on one of the topic's delivery-failure metrics lists the
 * topic itself in its `alarmActions` — see the README's "Alert topics" for why
 * that notification is lost. Applies to custom alarms as well as recommended
 * ones, since it is keyed on the metric. OK actions are not checked: an OK
 * transition means delivery has recovered.
 *
 * A relationship guard in the sense of ADR-0011. Actions are commonly attached
 * by an Aspect (`alarmActionsPolicy`), so the check is an Aspect too, on the
 * alarm and acting on its `CfnAlarm`: CDK runs Aspects inherited from an
 * ancestor before the node's own, so the actions are in place when it reads
 * them. It reads the resolved L1 value, so it sees actions however they were
 * added.
 */
export function guardAlarmSelfNotification(
  alarm: Alarm,
  topic: ITopic,
  id: string,
  key: string,
): void {
  // An `Alarm`'s default child is always its `CfnAlarm`.
  const cfn = alarm.node.defaultChild as CfnAlarm;

  Aspects.of(alarm).add({
    visit(node: IConstruct): void {
      if (node !== cfn || !DELIVERY_FAILURE_METRICS.has(cfn.metricName ?? "")) return;

      const stack = Stack.of(cfn);
      const actions: unknown = stack.resolve(cfn.alarmActions);
      if (!Array.isArray(actions)) return;

      const topicArn = JSON.stringify(stack.resolve(topic.topicArn));
      if (!actions.some((action) => JSON.stringify(action) === topicArn)) return;

      Annotations.of(alarm).addWarningV2(
        TOPIC_ALARM_SELF_NOTIFICATION_WARNING_ID,
        `TopicBuilder "${id}": alarm "${key}" notifies the topic it watches. It fires when SNS ` +
          `fails to deliver this topic's messages, so its own notification can only reach ` +
          `subscriptions that are still delivering — on a single-subscriber topic, none. Send it ` +
          `to a different topic, or turn it off on an alert topic with recommendedAlarms(false). ` +
          `Acknowledge "${TOPIC_ALARM_SELF_NOTIFICATION_WARNING_ID}" to silence this.`,
      );
    },
  });
}
