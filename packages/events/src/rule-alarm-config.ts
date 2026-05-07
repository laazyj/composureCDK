import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an EventBridge rule.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EventBridge
 * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring-events-best-practices.html
 */
export interface RuleAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when EventBridge fails to deliver matched events to a target.
   *
   * Metric: `AWS/Events FailedInvocations`, statistic Sum, period 1 minute.
   * Default threshold: > 0 failures.
   *
   * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring-events-best-practices.html
   */
  failedInvocations?: AlarmConfig | false;

  /**
   * Alarm when invocations are throttled (e.g. by service-side concurrency
   * limits or quota).
   *
   * Metric: `AWS/Events ThrottledRules`, statistic Sum, period 1 minute.
   * Default threshold: > 0 throttles.
   */
  throttledRules?: AlarmConfig | false;

  /**
   * Alarm when events that could not be delivered are sent to a target's
   * dead-letter queue. Only emits data when at least one target has a DLQ
   * attached and EventBridge attempts redrive; {@link TreatMissingData.NOT_BREACHING}
   * keeps it quiet otherwise.
   *
   * Metric: `AWS/Events InvocationsSentToDlq`, statistic Sum, period 1 minute.
   * Default threshold: > 0 redrives.
   *
   * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html
   */
  invocationsSentToDlq?: AlarmConfig | false;

  /**
   * Alarm when events could not even be delivered to a dead-letter queue.
   * Indicates a misconfiguration (e.g. missing EventBridge permission on
   * the DLQ) that results in event loss.
   *
   * Metric: `AWS/Events InvocationsFailedToBeSentToDlq`, statistic Sum,
   * period 1 minute.
   * Default threshold: > 0 failed redrives.
   */
  invocationsFailedToBeSentToDlq?: AlarmConfig | false;
}
