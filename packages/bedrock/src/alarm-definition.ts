import { ComparisonOperator, type Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type {
  AlarmConfig,
  AlarmConfigDefaults,
  AlarmDefinition,
  ResolvedAlarmConfig,
} from "@composurecdk/cloudwatch";
import { resolveAlarmConfig } from "@composurecdk/cloudwatch";

/**
 * 3 breaching minutes out of 5: SDK retries absorb isolated throttles and
 * transient errors, so a single datapoint is noise. No traffic emits no data.
 * @internal
 */
export const SUSTAINED = {
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

/** A greater-than alarm definition from a resolved config. @internal */
export function toDefinition(
  key: string,
  metric: Metric,
  cfg: ResolvedAlarmConfig,
  description: string,
): AlarmDefinition {
  return {
    key,
    alarmName: cfg.alarmName,
    metric,
    threshold: cfg.threshold,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: cfg.evaluationPeriods,
    datapointsToAlarm: cfg.datapointsToAlarm,
    treatMissingData: cfg.treatMissingData,
    description,
  };
}

/** A recommended alarm on one metric. @internal */
export interface ThresholdAlarmSpec {
  metricName: string;
  statistic: string;
  /** Absent for opt-in alarms, whose threshold the caller must supply. */
  defaults?: AlarmConfigDefaults;
  describe: (threshold: number) => string;
}

/**
 * Resolves each spec against the caller's config: on-by-default alarms merge
 * over their defaults, opt-in alarms are created only when configured, with
 * a threshold. @internal
 */
export function resolveThresholdAlarms<K extends string>(
  specs: Record<K, ThresholdAlarmSpec>,
  config: Partial<Record<K, AlarmConfig | false>> | undefined,
  metric: (metricName: string, statistic: string) => Metric,
): AlarmDefinition[] {
  return (Object.keys(specs) as K[]).flatMap((key) => {
    const spec = specs[key];
    const userConfig = config?.[key];
    if (userConfig === false || (userConfig === undefined && !spec.defaults)) return [];
    if (!spec.defaults && userConfig?.threshold === undefined) {
      throw new Error(
        `The "${key}" alarm has no default threshold. Supply one, e.g. ` +
          `recommendedAlarms({ ${key}: { threshold: … } }).`,
      );
    }
    const cfg = resolveAlarmConfig(userConfig, spec.defaults ?? { ...SUSTAINED, threshold: 0 });
    return [
      toDefinition(key, metric(spec.metricName, spec.statistic), cfg, spec.describe(cfg.threshold)),
    ];
  });
}
