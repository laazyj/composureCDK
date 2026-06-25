import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Configuration for a percentage-based contextual alarm.
 *
 * Derived from {@link AlarmConfig} with `threshold` replaced by
 * `thresholdPercent`. These alarms derive their threshold as a
 * percentage of a function property (e.g., timeout or reserved
 * concurrency). The threshold automatically adjusts when the base
 * value changes, keeping the alarm true to its definition.
 *
 * For a fixed absolute threshold, disable the recommended alarm and
 * add a custom one via {@link IFunctionBuilder.addAlarm}.
 */
export type PercentageAlarmConfig = Omit<AlarmConfig, "threshold"> & {
  /**
   * Threshold as a fraction of the base value (e.g., `0.9` = 90%).
   * Must be between 0 and 1 (exclusive of 0).
   */
  thresholdPercent?: number;
};

/**
 * Type for percentage-based defaults. Mirrors {@link AlarmConfigDefaults}:
 * every tunable field is required, but `alarmName` is intentionally not.
 */
export type PercentageAlarmConfigDefaults = Required<Omit<PercentageAlarmConfig, "alarmName">>;

/**
 * Controls which recommended alarms are created for a Lambda function.
 * All alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} or {@link PercentageAlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
 */
export interface FunctionAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the function produces invocation errors.
   *
   * Metric: `AWS/Lambda Errors`, statistic Sum, period 1 minute.
   * Default threshold: > 0 errors.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
   */
  errors?: AlarmConfig | false;

  /**
   * Alarm when invocations are throttled.
   *
   * Metric: `AWS/Lambda Throttles`, statistic Sum, period 1 minute.
   * Default threshold: > 0 throttles.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
   */
  throttles?: AlarmConfig | false;

  /**
   * Alarm when p99 duration approaches the configured timeout.
   *
   * Only created when the function has a `timeout` configured, since
   * the threshold is derived as a percentage of the timeout value.
   *
   * Metric: `AWS/Lambda Duration`, statistic p99, period 1 minute.
   * Default: 90% of the function timeout (`thresholdPercent: 0.9`).
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
   */
  duration?: PercentageAlarmConfig | false;

  /**
   * Alarm when concurrent executions approach the reserved limit.
   *
   * Only created when `reservedConcurrentExecutions` is configured,
   * since the threshold is derived as a percentage of the reserved limit.
   *
   * Metric: `AWS/Lambda ConcurrentExecutions`, statistic Maximum, period 1 minute.
   * Default: 80% of reservedConcurrentExecutions (`thresholdPercent: 0.8`).
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
   */
  concurrentExecutions?: PercentageAlarmConfig | false;

  /**
   * Alarm when an event source fails to invoke the function.
   *
   * Contextual: one alarm is created per event source attached via
   * {@link IFunctionBuilder.addEventSource} whose kind emits per-mapping ESM
   * metrics (currently SQS). The created alarm's key is the event source's
   * key suffixed with `FailedInvocations` (e.g. `ordersFailedInvocations`);
   * this config tunes every such alarm.
   *
   * Metric: `AWS/Lambda FailedInvokeEventCount`, statistic Sum, period 1
   * minute, dimensioned on the event source mapping. Default threshold: > 0.
   *
   * @see https://aws.amazon.com/blogs/compute/introducing-new-event-source-mapping-esm-metrics-for-aws-lambda/
   */
  eventSourceFailedInvocations?: AlarmConfig | false;

  /**
   * Alarm when an event source drops events after exhausting retries or TTL.
   *
   * Contextual: one alarm is created per event source attached via
   * {@link IFunctionBuilder.addEventSource} whose kind emits per-mapping ESM
   * metrics (currently SQS). The created alarm's key is the event source's
   * key suffixed with `DroppedEvents` (e.g. `ordersDroppedEvents`); this
   * config tunes every such alarm.
   *
   * Metric: `AWS/Lambda DroppedEventCount`, statistic Sum, period 1 minute,
   * dimensioned on the event source mapping. Default threshold: > 0.
   *
   * @see https://aws.amazon.com/blogs/compute/introducing-new-event-source-mapping-esm-metrics-for-aws-lambda/
   */
  eventSourceDroppedEvents?: AlarmConfig | false;

  /**
   * Alarm when the function is falling behind a stream event source.
   *
   * Contextual: a single alarm is created when at least one stream event
   * source (currently DynamoDB streams) is attached via
   * {@link IFunctionBuilder.addEventSource}. Unlike the per-mapping
   * {@link FunctionAlarmConfig.eventSourceFailedInvocations} /
   * {@link FunctionAlarmConfig.eventSourceDroppedEvents} alarms, `IteratorAge`
   * is a function-level metric, so there is one alarm per function (keyed
   * `iteratorAge`) regardless of how many stream sources are attached.
   *
   * The threshold is an absolute age in milliseconds (not a percentage).
   *
   * Metric: `AWS/Lambda IteratorAge`, statistic Maximum, period 1 minute,
   * dimensioned on `FunctionName`. AWS recommends alarming on this metric for
   * stream consumers but does not prescribe a threshold (it is workload
   * dependent); the default is a deliberately conservative > 60000 ms (60s) for
   * 3 consecutive minutes.
   *
   * @see https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics.html
   */
  eventSourceIteratorAge?: AlarmConfig | false;
}
