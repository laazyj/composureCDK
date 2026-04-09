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
}
