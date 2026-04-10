import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a CloudFront distribution.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * Function-level alarms (FunctionValidationErrors, FunctionExecutionErrors,
 * FunctionThrottles) require per-function dimensions and are not created
 * automatically. Use {@link IDistributionBuilder.addAlarm} to add them.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront
 */
export interface DistributionAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the distribution's 5xx error rate is elevated.
   *
   * Metric: `AWS/CloudFront 5xxErrorRate`, statistic Average, period 1 minute.
   * Default threshold: > 5 (5% error rate).
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront
   */
  errorRate?: AlarmConfig | false;

  /**
   * Alarm when origin response latency is elevated.
   *
   * Metric: `AWS/CloudFront OriginLatency`, statistic p90, period 1 minute.
   * Default threshold: > 5000ms (5 seconds).
   *
   * Requires [additional CloudFront metrics](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/viewing-cloudfront-metrics.html#monitoring-console.distributions-additional)
   * to be enabled on the distribution for this alarm to receive data.
   * With the default `treatMissingData: NOT_BREACHING`, the alarm will
   * not fire when additional metrics are not enabled.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront
   */
  originLatency?: AlarmConfig | false;
}
