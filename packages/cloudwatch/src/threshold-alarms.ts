import { ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig, AlarmConfigDefaults } from "./alarm-config.js";
import type { AlarmDefinition, AlarmMetric } from "./alarm-definition.js";
import {
  type AlarmThresholdBasisOptions,
  resolveAlarmThresholdBasis,
} from "./alarm-threshold-basis.js";
import { type ResolvedAlarmConfig, resolveAlarmConfig } from "./resolve-alarm-config.js";

/**
 * 3 breaching periods out of 5, so a single noisy datapoint does not alarm.
 * Missing data (no traffic) is not breaching.
 */
export const SUSTAINED_ALARM_DEFAULTS: Omit<AlarmConfigDefaults, "threshold"> = {
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

/** A greater-than alarm definition from a resolved config. */
export function greaterThanAlarmDefinition(
  key: string,
  metric: AlarmMetric,
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

/** A recommended greater-than alarm on one metric. */
export interface ThresholdAlarmSpec {
  metricName: string;
  statistic: string;
  /** Absent for opt-in alarms, whose threshold the caller must supply. */
  defaults?: AlarmConfigDefaults;
  describe: (threshold: number) => string;
}

/**
 * Resolves each spec against the caller's config: on-by-default alarms merge
 * over their defaults; opt-in alarms are created only when configured with a
 * threshold, using {@link SUSTAINED_ALARM_DEFAULTS}.
 */
export function resolveThresholdAlarms<K extends string>(
  specs: Record<K, ThresholdAlarmSpec>,
  config: Partial<Record<K, AlarmConfig | false>> | undefined,
  metric: (metricName: string, statistic: string) => AlarmMetric,
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
    const cfg = resolveAlarmConfig(
      userConfig,
      spec.defaults ?? { ...SUSTAINED_ALARM_DEFAULTS, threshold: 0 },
    );
    return [
      greaterThanAlarmDefinition(
        key,
        metric(spec.metricName, spec.statistic),
        cfg,
        spec.describe(cfg.threshold),
      ),
    ];
  });
}

/** Configures an alarm on usage of a quota the caller supplies. */
export type QuotaAlarmConfig = Omit<AlarmConfig, "threshold"> & {
  /** The applied quota, in the metric's unit. */
  quota: number;
  /** Threshold as a fraction of {@link quota}, in (0, 1]. */
  thresholdPercent?: number;
};

/** Inputs to {@link resolveQuotaAlarm}. */
export interface QuotaAlarmOptions extends Pick<
  AlarmThresholdBasisOptions<number>,
  "scope" | "warningId" | "alarmLabel"
> {
  key: string;
  config: QuotaAlarmConfig | false | undefined;
  metric: () => AlarmMetric;
  /** Used when the config sets no `thresholdPercent`. */
  defaultThresholdPercent: number;
  describe: (quota: number, thresholdPercent: number) => string;
}

/**
 * Resolves an opt-in alarm on usage above a fraction of a caller-supplied
 * quota. AWS quotas vary by account and Region, so the library never guesses
 * one. Returns no alarm when the config is absent, or when the quota is a
 * token (with a warning).
 */
export function resolveQuotaAlarm(opts: QuotaAlarmOptions): AlarmDefinition[] {
  const { config, key } = opts;
  if (!config) return [];
  const quota = resolveAlarmThresholdBasis({
    scope: opts.scope,
    value: config.quota,
    resolve: (q) => q,
    warningId: opts.warningId,
    alarmLabel: opts.alarmLabel,
    suppressHint: `recommendedAlarms({ ${key}: false })`,
  });
  if (quota === undefined) return [];
  const percent = config.thresholdPercent ?? opts.defaultThresholdPercent;
  if (!(quota > 0)) {
    throw new Error(`${key}: quota must be a positive number, got ${String(quota)}.`);
  }
  if (!(percent > 0 && percent <= 1)) {
    throw new Error(`${key}: thresholdPercent must be in (0, 1], got ${String(percent)}.`);
  }
  const cfg = resolveAlarmConfig(
    { ...config, threshold: Math.floor(quota * percent) },
    { ...SUSTAINED_ALARM_DEFAULTS, threshold: 0 },
  );
  return [greaterThanAlarmDefinition(key, opts.metric(), cfg, opts.describe(quota, percent))];
}
