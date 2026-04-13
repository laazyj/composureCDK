import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Extended {@link AlarmConfig} for the account-level `EstimatedCharges`
 * billing alarm.
 *
 * The `EstimatedCharges` metric lives in the `AWS/Billing` namespace and
 * is **only emitted in the `us-east-1` region**, regardless of where your
 * resources run. The alarm created by {@link createBudgetBuilder} will
 * therefore only receive datapoints when it is synthesised into a stack
 * deployed to `us-east-1`.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
 */
export interface EstimatedChargesAlarmConfig extends AlarmConfig {
  /**
   * The absolute cost threshold (in `currency`) at which the alarm fires.
   * This is a hard monetary value, **not** a percentage of the budget.
   */
  threshold: number;

  /**
   * ISO 4217 currency code that the `EstimatedCharges` metric is
   * emitted in. AWS emits the metric with a `Currency` dimension that
   * must match your billing currency.
   *
   * @default "USD"
   */
  currency?: string;
}

/**
 * Controls which recommended CloudWatch alarms are created for an AWS
 * Budget.
 *
 * AWS Budgets itself does not publish per-budget CloudWatch metrics.
 * The recommended-alarm surface therefore mirrors the well-architected
 * cost-monitoring pattern: a CloudWatch alarm on the account-level
 * `AWS/Billing EstimatedCharges` metric that fires when total estimated
 * charges cross a hard threshold.
 *
 * Off by default — the alarm is only useful when the stack is deployed
 * to `us-east-1`, so callers must opt in explicitly.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
 */
export interface BudgetAlarmConfig {
  /**
   * Master switch.
   * @default false
   */
  enabled?: boolean;

  /**
   * Configuration for the `EstimatedCharges` billing alarm.
   *
   * Pass `false` to disable, or supply an
   * {@link EstimatedChargesAlarmConfig} to enable with a specific
   * monetary threshold.
   */
  estimatedCharges?: EstimatedChargesAlarmConfig | false;
}
