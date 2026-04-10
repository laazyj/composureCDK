import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an S3 bucket.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * S3 request metric alarms (5xxErrors, 4xxErrors) require
 * [CloudWatch request metrics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/configure-request-metrics-bucket.html)
 * to be enabled on the bucket. Alarms are automatically created for each
 * entry in the bucket's {@link BucketProps.metrics} array, keyed by the
 * metrics configuration ID (e.g. `serverErrors:EntireBucket`).
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3
 */
export interface BucketAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when S3 returns server-side errors (5xx HTTP status codes).
   *
   * Metric: `AWS/S3 5xxErrors`, statistic Sum, period 5 minutes.
   * Default threshold: > 0 errors.
   *
   * Only created when the bucket has request metrics configured via
   * {@link BucketProps.metrics}. One alarm per metrics configuration.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3
   */
  serverErrors?: AlarmConfig | false;

  /**
   * Alarm when S3 returns client-side errors (4xx HTTP status codes).
   *
   * Metric: `AWS/S3 4xxErrors`, statistic Sum, period 5 minutes.
   * Default threshold: > 0 errors.
   *
   * Only created when the bucket has request metrics configured via
   * {@link BucketProps.metrics}. One alarm per metrics configuration.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3
   */
  clientErrors?: AlarmConfig | false;
}
