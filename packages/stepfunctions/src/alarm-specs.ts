import { Duration } from "aws-cdk-lib";
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

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/** One recommended alarm on a resource of type `T`. */
export interface AlarmSpec<T> {
  /** The resource's metric, given the 1-minute period every alarm here uses. */
  metric: (target: T, options: MetricOptions) => AlarmMetric;
  /** Whether the alarm applies to this resource; applies to every one when unset. */
  appliesTo?: (target: T) => boolean;
  /** What the alarm firing means, without its threshold. */
  describe: string;
}

/** A recommended-alarm config: a master switch plus one entry per alarm. */
type SpecAlarmConfig<K extends string> = { enabled?: boolean } & Partial<
  Record<K, AlarmConfig | false>
>;

/** A resource's recommended alarms: one spec and one default per config key. */
export interface AlarmSet<T, K extends string> {
  specs: Record<K, AlarmSpec<T>>;
  defaults: Record<K, AlarmConfigDefaults>;
}

/**
 * Creates a resource's recommended alarms, merged with any custom alarms added
 * via `addAlarm()`. Every recommended alarm fires above its threshold, on the
 * resource's own metric over one minute.
 *
 * @returns A record mapping alarm keys to their created Alarm constructs.
 */
export function createSpecAlarms<T, K extends string>(
  scope: IConstruct,
  id: string,
  target: T,
  { specs, defaults }: AlarmSet<T, K>,
  config: SpecAlarmConfig<K> | false | undefined,
  customAlarms: AlarmDefinitionBuilder<T>[],
): Record<string, Alarm> {
  const recommended: AlarmDefinition[] =
    config === false || config?.enabled === false
      ? []
      : (Object.keys(specs) as K[]).flatMap((key) => {
          const spec = specs[key];
          const userConfig = config?.[key];
          if (userConfig === false || !(spec.appliesTo?.(target) ?? true)) return [];
          const cfg = resolveAlarmConfig(userConfig, defaults[key]);
          return {
            key,
            alarmName: cfg.alarmName,
            metric: spec.metric(target, { period: METRIC_PERIOD }),
            threshold: cfg.threshold,
            comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: cfg.evaluationPeriods,
            datapointsToAlarm: cfg.datapointsToAlarm,
            treatMissingData: cfg.treatMissingData,
            description: `${spec.describe} Threshold: > ${String(cfg.threshold)} in ${METRIC_PERIOD_LABEL}.`,
          };
        });

  return createAlarms(scope, id, [...recommended, ...customAlarms.map((b) => b.resolve(target))]);
}
