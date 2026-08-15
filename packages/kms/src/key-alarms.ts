import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { KeyAlarmConfig } from "./alarm-config.js";
import { KEY_ALARM_DEFAULTS } from "./alarm-defaults.js";

/**
 * The metric is a slow countdown towards a date, so an hourly Minimum is
 * ample resolution — and with `treatMissingData: ignore` a period that
 * outruns KMS's publication cadence costs nothing but a latched state.
 */
const METRIC_PERIOD = Duration.hours(1);

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a KMS key.
 *
 * The `keyMaterialExpiration` alarm is opt-in: it is created only when the
 * config asks for it, because AWS KMS publishes the underlying metric solely
 * for keys with imported, expiring key material.
 */
export function resolveKeyAlarmDefinitions(
  key: IKey,
  config: KeyAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  const expiry = config?.keyMaterialExpiration;
  if (expiry) {
    const cfg = resolveAlarmConfig(
      expiry === true ? undefined : expiry,
      KEY_ALARM_DEFAULTS.keyMaterialExpiration,
    );
    definitions.push({
      key: "keyMaterialExpiration",
      alarmName: cfg.alarmName,
      metric: new Metric({
        namespace: "AWS/KMS",
        metricName: "SecondsUntilKeyMaterialExpiration",
        dimensionsMap: { KeyId: key.keyId },
        statistic: "Minimum",
        period: METRIC_PERIOD,
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `Imported KMS key material is approaching expiry. ` +
        `Threshold: <= ${String(cfg.threshold)} seconds remaining.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for a KMS key, merging recommended
 * definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param key - The KMS key to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html
 */
export function createKeyAlarms(
  scope: IConstruct,
  id: string,
  key: IKey,
  config: KeyAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<IKey>[] = [],
): Record<string, Alarm> {
  const recommended = config === false ? [] : resolveKeyAlarmDefinitions(key, config);
  const custom = customAlarms.map((b) => b.resolve(key));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
