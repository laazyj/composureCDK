import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an SNS topic.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
 */
export interface TopicAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when SNS fails to deliver notifications to subscribed endpoints.
   *
   * Metric: `AWS/SNS NumberOfNotificationsFailed`, statistic Sum, period 1 minute.
   * Default threshold: > 0 failures.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  numberOfNotificationsFailed?: AlarmConfig | false;

  /**
   * Alarm when messages are rejected due to invalid subscription filter
   * policy attributes.
   *
   * Metric: `AWS/SNS NumberOfNotificationsFilteredOut-InvalidAttributes`,
   * statistic Sum, period 1 minute.
   * Default threshold: > 0 filtered messages.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  numberOfNotificationsFilteredOutInvalidAttributes?: AlarmConfig | false;

  /**
   * Alarm when messages are moved to a subscription's dead-letter queue
   * because SNS could not deliver them to the subscribed endpoint.
   *
   * This metric is topic-level even though DLQs are attached per subscription,
   * so the recommended alarm lives on the topic. It only emits data when at
   * least one subscription on the topic has a DLQ attached and SNS attempts
   * redrive; {@link TreatMissingData.NOT_BREACHING} keeps it quiet otherwise.
   *
   * Metric: `AWS/SNS NumberOfNotificationsRedrivenToDlq`, statistic Sum,
   * period 1 minute, dimension `TopicName`.
   * Default threshold: > 0 redrives.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
   */
  numberOfNotificationsRedrivenToDlq?: AlarmConfig | false;

  /**
   * Alarm when messages could not even be moved to a dead-letter queue.
   * Indicates a misconfiguration (e.g. missing SNS permission on the DLQ)
   * that results in message loss.
   *
   * Metric: `AWS/SNS NumberOfNotificationsFailedToRedriveToDlq`, statistic Sum,
   * period 1 minute, dimension `TopicName`.
   * Default threshold: > 0 failed redrives.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  numberOfNotificationsFailedToRedriveToDlq?: AlarmConfig | false;
}
