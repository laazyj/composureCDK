import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a CloudFront distribution.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * Function-level alarms are created automatically for every inline function
 * declared on a behavior — see {@link FunctionAlarmConfig} to tune them.
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

/**
 * Controls which recommended alarms are created for a CloudFront Function
 * declared inline on a cache behavior. All alarms are enabled by default
 * with AWS-recommended thresholds. Set individual alarms to `false` to
 * disable them, or provide an {@link AlarmConfig} to tune thresholds.
 *
 * CloudFront Function metrics are emitted in the `us-east-1` region only
 * (CloudFront is a global service). The alarms live in the stack's region —
 * if that is not `us-east-1`, the alarms will not receive data.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
 */
export interface FunctionAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms for
   * this function. Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the function raises runtime exceptions while processing a
   * viewer request or response.
   *
   * Metric: `AWS/CloudFront FunctionExecutionErrors`, statistic Sum,
   * period 1 minute. Default threshold: > 0 errors.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
   */
  executionErrors?: AlarmConfig | false;

  /**
   * Alarm when the function returns an event object that fails validation
   * (e.g. malformed headers, unsupported response shape).
   *
   * Metric: `AWS/CloudFront FunctionValidationErrors`, statistic Sum,
   * period 1 minute. Default threshold: > 0 errors.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
   */
  validationErrors?: AlarmConfig | false;

  /**
   * Alarm when the function is throttled — typically because it exceeded
   * the 1ms compute-utilization budget.
   *
   * Metric: `AWS/CloudFront FunctionThrottles`, statistic Sum,
   * period 1 minute. Default threshold: > 0 throttles.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html
   */
  throttles?: AlarmConfig | false;
}
