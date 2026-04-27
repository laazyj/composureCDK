import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { CertificateAlarmConfig } from "./alarm-config.js";
import { CERTIFICATE_ALARM_DEFAULTS } from "./alarm-defaults.js";

const METRIC_PERIOD = Duration.days(1);

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an ACM certificate.
 */
export function resolveCertificateAlarmDefinitions(
  certificate: ICertificate,
  config: CertificateAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.daysToExpiry !== false) {
    const cfg = resolveAlarmConfig(config?.daysToExpiry, CERTIFICATE_ALARM_DEFAULTS.daysToExpiry);
    definitions.push({
      key: "daysToExpiry",
      metric: certificate.metricDaysToExpiry({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `ACM certificate is approaching expiry. Threshold: <= ${String(cfg.threshold)} days remaining.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an ACM certificate,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param certificate - The ACM certificate to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CertificateManager
 */
export function createCertificateAlarms(
  scope: IConstruct,
  id: string,
  certificate: ICertificate,
  config: CertificateAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<ICertificate>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? CERTIFICATE_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveCertificateAlarmDefinitions(certificate, config);
  const custom = customAlarms.map((b) => b.resolve(certificate));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
