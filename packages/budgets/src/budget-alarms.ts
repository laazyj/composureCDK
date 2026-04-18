import { Duration, Stack, Token } from "aws-cdk-lib";
import {
  type Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import { createAlarms, type AlarmDefinition } from "@composurecdk/cloudwatch";
import type { BudgetAlarmConfig } from "./alarm-config.js";

const BILLING_METRIC_REGION = "us-east-1";

/**
 * Creates the opted-in billing alarms for a budget.
 *
 * Currently only produces the account-level `EstimatedCharges` alarm,
 * because that is the only CloudWatch metric AWS emits that is directly
 * useful alongside a budget. Off by default — callers must opt in via
 * {@link BudgetAlarmConfig.enabled} or by passing an
 * {@link BudgetAlarmConfig.estimatedCharges} config.
 *
 * Throws at synth time if the surrounding stack is not deployed to
 * `us-east-1` (or has no concrete region pinned). The
 * `AWS/Billing EstimatedCharges` metric is only emitted in `us-east-1`,
 * so creating the alarm elsewhere would produce a resource that never
 * receives datapoints — a silent failure. The check is explicit so the
 * caller must either pin the stack to `us-east-1` or remove the alarm.
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

  const region = Stack.of(scope).region;
  if (Token.isUnresolved(region)) {
    throw new Error(
      `BudgetBuilder "${id}": recommendedAlarms.estimatedCharges requires a stack with a concrete region set to "${BILLING_METRIC_REGION}". ` +
        `The AWS/Billing EstimatedCharges metric is only emitted in ${BILLING_METRIC_REGION}, so a region-agnostic stack cannot be validated at synth time. ` +
        `Either pin the stack region (env: { region: "${BILLING_METRIC_REGION}" }) or remove estimatedCharges.`,
    );
  }
  if (region !== BILLING_METRIC_REGION) {
    throw new Error(
      `BudgetBuilder "${id}": recommendedAlarms.estimatedCharges can only be created in ${BILLING_METRIC_REGION} (got "${region}"). ` +
        `The AWS/Billing EstimatedCharges metric is only emitted in ${BILLING_METRIC_REGION}; an alarm in any other region would never receive datapoints. ` +
        `Deploy this stack to ${BILLING_METRIC_REGION} or remove estimatedCharges from recommendedAlarms.`,
    );
  }

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
