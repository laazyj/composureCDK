import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a DynamoDB table.
 * All applicable alarms are enabled by default with AWS-recommended
 * thresholds. Set individual alarms to `false` to disable them, or provide
 * an {@link AlarmConfig} to tune thresholds.
 *
 * The defaults target a table-scoped view of availability and throttling.
 * Account-level recommended alarms (e.g. `AccountProvisionedReadCapacityUtilization`)
 * and provisioned-capacity utilization alarms are not created here — see the
 * package README for the rationale.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB
 */
export interface TableAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm on server-side errors (HTTP 500) returned by the table. These are
   * faults on the DynamoDB side rather than the caller's, so any sustained
   * occurrence is worth surfacing. Summed across all operations.
   *
   * Metric: `AWS/DynamoDB SystemErrors` (summed per-operation via a math
   * expression), statistic Sum, period 1 minute.
   * Default threshold: > 0.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB
   */
  systemErrors?: AlarmConfig | false;

  /**
   * Alarm when read requests are throttled. On an on-demand table sustained
   * read throttling signals traffic ramping faster than DynamoDB's adaptive
   * scaling can follow, or a hot partition; on a provisioned table it signals
   * under-provisioned read capacity.
   *
   * Metric: `AWS/DynamoDB ReadThrottleEvents`, statistic Sum, period 1 minute.
   * Default threshold: > 0.
   *
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html
   */
  readThrottleEvents?: AlarmConfig | false;

  /**
   * Alarm when write requests are throttled. As with read throttling, this
   * indicates a hot partition or capacity that cannot keep up with the write
   * rate.
   *
   * Metric: `AWS/DynamoDB WriteThrottleEvents`, statistic Sum, period 1 minute.
   * Default threshold: > 0.
   *
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html
   */
  writeThrottleEvents?: AlarmConfig | false;
}
