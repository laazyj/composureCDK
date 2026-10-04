import { Annotations, Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, type MetricOptions } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import type {
  AlarmConfig,
  AlarmConfigDefaults,
  AlarmDefinition,
  AlarmDefinitionBuilder,
  AlarmMetric,
} from "@composurecdk/cloudwatch";
import { createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Warning id for a recommended alarm configured on a resource it does not apply
 * to, such as a Standard-only alarm on an Express state machine. The
 * configuration is ignored. Acknowledge via
 * `Annotations.of(scope).acknowledgeWarning(INAPPLICABLE_ALARM_CONFIG_WARNING_ID)`
 * where that is intended, so the id must stay stable.
 */
export const INAPPLICABLE_ALARM_CONFIG_WARNING_ID =
  "@composurecdk/stepfunctions:inapplicable-alarm-config";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/** One recommended alarm on a resource of type `T`. */
export interface AlarmSpec<T extends IConstruct> {
  /** The resource's metric, given the 1-minute period every alarm here uses. */
  metric: (target: T, options: MetricOptions) => AlarmMetric;
  /**
   * Which resources the alarm applies to; every one when unset. `label` names
   * them in the warning raised when the alarm is configured on another.
   */
  appliesTo?: { test: (target: T) => boolean; label: string };
  /** What the alarm firing means, without its threshold. */
  describe: string;
}

/** A recommended-alarm config: a master switch plus one entry per alarm. */
type SpecAlarmConfig<K extends string> = { enabled?: boolean } & Partial<
  Record<K, AlarmConfig | false>
>;

/** A resource's recommended alarms: one spec and one default per config key. */
export interface AlarmSet<T extends IConstruct, K extends string> {
  specs: Record<K, AlarmSpec<T>>;
  defaults: Record<K, AlarmConfigDefaults>;
}

/**
 * Creates a resource's recommended alarms, merged with any custom alarms added
 * via `addAlarm()`. Every recommended alarm fires above its threshold, on the
 * resource's own metric over one minute. An alarm whose `appliesTo` excludes
 * the resource is skipped, with a warning if the caller configured it.
 *
 * @returns A record mapping alarm keys to their created Alarm constructs.
 */
export function createSpecAlarms<T extends IConstruct, K extends string>(
  scope: IConstruct,
  id: string,
  target: T,
  { specs, defaults }: AlarmSet<T, K>,
  config: SpecAlarmConfig<K> | false | undefined,
  customAlarms: AlarmDefinitionBuilder<T>[],
): Record<string, Alarm> {
  const recommended: AlarmDefinition[] = [];
  if (config !== false && config?.enabled !== false) {
    for (const key of Object.keys(specs) as K[]) {
      const spec = specs[key];
      const userConfig = config?.[key];
      const gate = spec.appliesTo;
      if (gate && !gate.test(target)) {
        if (userConfig) {
          Annotations.of(target).addWarningV2(
            INAPPLICABLE_ALARM_CONFIG_WARNING_ID,
            `recommendedAlarms.${key} applies only to ${gate.label}; the alarm is not ` +
              `created. Remove the setting or set it to false.`,
          );
        }
        continue;
      }
      if (userConfig === false) continue;
      const cfg = resolveAlarmConfig(userConfig, defaults[key]);
      recommended.push({
        key,
        alarmName: cfg.alarmName,
        metric: spec.metric(target, { period: METRIC_PERIOD }),
        threshold: cfg.threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: `${spec.describe} Threshold: > ${String(cfg.threshold)} in ${METRIC_PERIOD_LABEL}.`,
      });
    }
  }

  return createAlarms(scope, id, [...recommended, ...customAlarms.map((b) => b.resolve(target))]);
}
