import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { ReputationAlarmConfig } from "./reputation-alarm-config.js";
import { REPUTATION_ALARM_DEFAULTS } from "./reputation-alarm-defaults.js";

/** SES namespace for account-level reputation metrics. */
const NAMESPACE = "AWS/SES";
/** AWS recommends a 1-hour period for the reputation-rate alarms. */
const METRIC_PERIOD = Duration.hours(1);

/** Builds an account-level (dimensionless) `AWS/SES` reputation-rate metric. */
function reputationMetric(metricName: string): Metric {
  return new Metric({
    namespace: NAMESPACE,
    metricName,
    statistic: "Average",
    period: METRIC_PERIOD,
  });
}

function asPercent(rate: number): string {
  return `${String(rate * 100)}%`;
}

/**
 * Resolves the recommended reputation alarm configuration into fully-resolved
 * {@link AlarmDefinition}s. Returns `[]` when alarms are disabled.
 */
export function resolveReputationAlarmDefinitions(
  config: ReputationAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.bounceRate !== false) {
    const cfg = resolveAlarmConfig(config?.bounceRate, REPUTATION_ALARM_DEFAULTS.bounceRate);
    definitions.push({
      key: "bounceRate",
      alarmName: cfg.alarmName,
      metric: reputationMetric("Reputation.BounceRate"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `Account hard-bounce rate has reached ${asPercent(cfg.threshold)}. SES places an ` +
        `account under review at 5% and may pause sending at 10%.`,
    });
  }

  if (config?.complaintRate !== false) {
    const cfg = resolveAlarmConfig(config?.complaintRate, REPUTATION_ALARM_DEFAULTS.complaintRate);
    definitions.push({
      key: "complaintRate",
      alarmName: cfg.alarmName,
      metric: reputationMetric("Reputation.ComplaintRate"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `Account complaint rate has reached ${asPercent(cfg.threshold)}. SES places an ` +
        `account under review at 0.1% and may pause sending at 0.5%.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended account-level SES reputation alarms, merging the
 * recommended definitions with any custom alarm builders.
 *
 * Disabling the recommended alarms (`config === false` or `config.enabled ===
 * false`) suppresses only the recommended definitions — custom alarms added via
 * `addAlarm()` are always created, since they are an explicit, separate opt-in.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param config - Recommended-alarm configuration, or `false` to disable the recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html
 */
export function createReputationAlarms(
  scope: IConstruct,
  id: string,
  config: ReputationAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<void>[] = [],
): Record<string, Alarm> {
  const recommended =
    config === false || config?.enabled === false ? [] : resolveReputationAlarmDefinitions(config);
  const custom = customAlarms.map((b) => b.resolve(undefined));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
