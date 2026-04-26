import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a Route 53 health check.
 * The single recommended alarm — `healthCheckStatus` — is enabled by default
 * with the AWS-recommended threshold. Set it to `false` to disable, or
 * provide an {@link AlarmConfig} to tune the threshold or evaluation window.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53
 */
export interface HealthCheckAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the health check is reporting unhealthy.
   *
   * Metric: `AWS/Route53 HealthCheckStatus`, statistic Minimum, period
   * 1 minute, dimension `HealthCheckId`. Minimum is the AWS-recommended
   * statistic — it surfaces "at least one Route 53 checker sees it down"
   * during the period.
   *
   * Default threshold: `< 1` for one consecutive 1-minute period.
   * Default `treatMissingData: breaching` — missing data is treated as
   * unhealthy, matching the AWS example.
   *
   * Note: `AWS/Route53` metrics are emitted only in `us-east-1`. Alarms
   * created against this metric in any other region will never receive
   * data. The builder emits a synth-time warning when this happens; for
   * stacks outside `us-east-1`, route the alarm into a `us-east-1` stack
   * via `createHealthCheckAlarmBuilder()` and `compose().withStacks()`.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53
   */
  healthCheckStatus?: AlarmConfig | false;
}
