import { Duration } from "aws-cdk-lib";
import {
  type Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import { createAlarms, type AlarmDefinition } from "@composurecdk/cloudwatch";
import type { BudgetAlarmConfig } from "./alarm-config.js";

/**
 * Creates the opted-in billing alarms for a budget.
 *
 * Currently only produces the account-level `EstimatedCharges` alarm,
 * because that is the only CloudWatch metric AWS emits that is directly
 * useful alongside a budget. Off by default — callers must opt in via
 * {@link BudgetAlarmConfig.enabled} or by passing an
 * {@link BudgetAlarmConfig.estimatedCharges} config.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
 */
export function createBudgetAlarms(
  scope: IConstruct,
  id: string,
  config: BudgetAlarmConfig | false | undefined,
): Record<string, Alarm> {
  if (!config) return {};
  if (config.enabled === false) return {};
  if (!config.estimatedCharges) return {};

  const cfg = config.estimatedCharges;

  const metric = new Metric({
    namespace: "AWS/Billing",
    metricName: "EstimatedCharges",
    dimensionsMap: { Currency: cfg.currency ?? "USD" },
    statistic: "Maximum",
    // Billing metrics only update every ~6 hours; a 6-hour period keeps
    // the alarm meaningful without oversampling.
    period: Duration.hours(6),
  });

  const definition: AlarmDefinition = {
    key: "estimatedCharges",
    metric,
    threshold: cfg.threshold,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: cfg.evaluationPeriods ?? 1,
    datapointsToAlarm: cfg.datapointsToAlarm ?? 1,
    treatMissingData: cfg.treatMissingData ?? TreatMissingData.NOT_BREACHING,
    description: `Account-level estimated charges exceeded ${String(cfg.threshold)} ${
      cfg.currency ?? "USD"
    }. Billing metrics are only emitted in us-east-1.`,
  };

  return createAlarms(scope, id, [definition]);
}
