import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an SNS subscription.
 *
 * All subscription alarms are only meaningful when the subscription has a
 * dead-letter queue attached — the underlying metrics are emitted by SNS
 * only in that case. When no DLQ is configured, `createSubscriptionAlarms`
 * returns an empty record regardless of this configuration.
 *
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
 */
export interface SubscriptionAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when messages are moved to the subscription's dead-letter queue
   * because SNS could not deliver them to the subscribed endpoint.
   *
   * Metric: `AWS/SNS NumberOfNotificationsRedrivenToDlq`, statistic Sum,
   * period 1 minute, dimension `TopicName`.
   * Default threshold: > 0 redrives.
   *
   * Only created when {@link SubscriptionBuilderProps.deadLetterQueue} is set.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  numberOfNotificationsRedrivenToDlq?: AlarmConfig | false;

  /**
   * Alarm when messages could not even be moved to the dead-letter queue.
   * Indicates a misconfiguration (e.g. missing SNS permission on the DLQ)
   * that results in message loss.
   *
   * Metric: `AWS/SNS NumberOfNotificationsFailedToRedriveToDlq`, statistic Sum,
   * period 1 minute, dimension `TopicName`.
   * Default threshold: > 0 failed redrives.
   *
   * Only created when {@link SubscriptionBuilderProps.deadLetterQueue} is set.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  numberOfNotificationsFailedToRedriveToDlq?: AlarmConfig | false;
}
