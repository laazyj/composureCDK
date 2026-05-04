import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import type { BudgetAlarmConfig } from "./alarm-config.js";
import { assertValidBudgetCurrency } from "./currency.js";

const BILLING_METRIC_PERIOD = Duration.hours(6);

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an AWS Budget.
 *
 * AWS Budgets does not publish per-budget CloudWatch metrics — the only
 * recommended alarm is the account-level `AWS/Billing EstimatedCharges`
 * billing alarm. Off by default: callers must pass an
 * {@link BudgetAlarmConfig.estimatedCharges} config to opt in.
 *
 * Period and statistic are fixed at the AWS-recommended values
 * (6 hours, Maximum) and not exposed as configuration knobs — billing
 * metrics only update every ~6 hours, so a shorter period would
 * oversample. Threshold, currency, evaluation periods, datapoints and
 * missing-data behaviour remain user-configurable via
 * {@link EstimatedChargesAlarmConfig}.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
 */
export function resolveBudgetAlarmDefinitions(
  config: BudgetAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];
  if (!config?.estimatedCharges) return [];

  const cfg = config.estimatedCharges;
  const currency = cfg.currency ?? "USD";
  assertValidBudgetCurrency(currency, `EstimatedChargesAlarmConfig: currency`);

  return [
    {
      key: "estimatedCharges",
      metric: new Metric({
        namespace: "AWS/Billing",
        metricName: "EstimatedCharges",
        dimensionsMap: { Currency: currency },
        statistic: "Maximum",
        period: BILLING_METRIC_PERIOD,
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods ?? 1,
      datapointsToAlarm: cfg.datapointsToAlarm ?? 1,
      treatMissingData: cfg.treatMissingData ?? TreatMissingData.NOT_BREACHING,
      description: `Account-level estimated charges exceeded ${String(cfg.threshold)} ${currency}. Billing metrics are only emitted in us-east-1.`,
    },
  ];
}
