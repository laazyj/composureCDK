import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IStream } from "aws-cdk-lib/aws-kinesis";
import type { IConstruct } from "constructs";
import type { AlarmDefinition, AlarmMetric } from "@composurecdk/cloudwatch";
import {
  type AlarmDefinitionBuilder,
  createAlarms,
  resolveAlarmConfig,
  resolveAlarmThresholdBasis,
} from "@composurecdk/cloudwatch";
import type { StreamAlarmConfig, StreamAlarmKey } from "./stream-alarm-config.js";
import {
  ITERATOR_AGE_ALARM_RETENTION_RATIO,
  STREAM_ALARM_DEFAULTS,
  type StreamAlarmDefaults,
  SUSTAINED_FIVE_MINUTES,
} from "./stream-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())}-minute`;

/** How one recommended stream alarm is measured and described. */
interface StreamAlarmSpec {
  /** Whether the alarm is created when the user hasn't configured it. */
  enabledByDefault: boolean;
  /**
   * The alarm's metric. The L2's canned metric methods default to a 5-minute
   * period and (mostly) the Average statistic, so both are always stated.
   */
  metric: (stream: IStream) => AlarmMetric;
  comparisonOperator: ComparisonOperator;
  /** What a breach means; the threshold sentence is appended. */
  summary: string;
  /** Unit appended to the threshold in the description, if any. */
  unit?: string;
}

const STREAM_ALARM_SPECS: Record<StreamAlarmKey, StreamAlarmSpec> = {
  getRecordsIteratorAgeMilliseconds: {
    enabledByDefault: true,
    metric: (stream) =>
      stream.metricGetRecordsIteratorAgeMilliseconds({
        period: METRIC_PERIOD,
        statistic: Stats.MAXIMUM,
      }),
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    summary:
      "Kinesis stream consumers are reading records close to the end of the stream's " +
      "retention period; records older than the retention period are deleted unread.",
    unit: " ms",
  },
  readProvisionedThroughputExceeded: {
    enabledByDefault: true,
    metric: (stream) =>
      stream.metricReadProvisionedThroughputExceeded({
        period: METRIC_PERIOD,
        statistic: Stats.AVERAGE,
      }),
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    summary: "Kinesis stream GetRecords calls are being throttled for exceeding read throughput.",
  },
  writeProvisionedThroughputExceeded: {
    enabledByDefault: true,
    metric: (stream) =>
      stream.metricWriteProvisionedThroughputExceeded({
        period: METRIC_PERIOD,
        statistic: Stats.AVERAGE,
      }),
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    summary: "Kinesis stream writes are being throttled for exceeding write throughput.",
  },
  putRecordSuccess: {
    enabledByDefault: true,
    metric: (stream) =>
      stream.metricPutRecordSuccess({ period: METRIC_PERIOD, statistic: Stats.AVERAGE }),
    comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
    summary: "Kinesis stream PutRecord calls are failing.",
  },
  getRecordsSuccess: {
    enabledByDefault: true,
    metric: (stream) =>
      stream.metricGetRecordsSuccess({ period: METRIC_PERIOD, statistic: Stats.AVERAGE }),
    comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
    summary: "Kinesis stream GetRecords calls are failing.",
  },
  putRecordsFailedRecords: {
    enabledByDefault: false,
    metric: (stream) =>
      stream.metricPutRecordsFailedRecords({ period: METRIC_PERIOD, statistic: Stats.SUM }),
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    summary: "Kinesis stream PutRecords batches have records rejected by internal failures.",
    unit: " records",
  },
};

const STREAM_ALARM_KEYS = Object.keys(STREAM_ALARM_SPECS) as StreamAlarmKey[];

/**
 * The iterator-age threshold derived from the stream's retention period, and
 * the basis it was derived from. `undefined` when the retention period is an
 * unresolved token: there is nothing to derive from, so the alarm is skipped
 * with an acknowledgeable warning (the library-wide derived-threshold
 * convention, see `resolveAlarmThresholdBasis`).
 */
function deriveIteratorAgeThreshold(
  stream: IStream,
  retentionPeriod: Duration | undefined,
): { threshold: number; basis: string } | undefined {
  const retentionMs = resolveAlarmThresholdBasis({
    scope: stream,
    value: retentionPeriod,
    resolve: (duration) => duration.toMilliseconds(),
    isUnresolved: (duration) => duration.isUnresolved(),
    warningId: "@composurecdk/kinesis:iterator-age-alarm-token-retention",
    alarmLabel: "Kinesis GetRecords iterator-age",
    suppressHint: "recommendedAlarms({ getRecordsIteratorAgeMilliseconds: false })",
  });
  if (retentionMs === undefined) return undefined;

  return {
    threshold: Math.round(retentionMs * ITERATOR_AGE_ALARM_RETENTION_RATIO),
    basis:
      ` (${String(ITERATOR_AGE_ALARM_RETENTION_RATIO * 100)}% of the stream's ` +
      `${String(retentionMs)} ms retention period)`,
  };
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a Kinesis data stream.
 *
 * @param retentionPeriod - The stream's merged `retentionPeriod`, from which
 *   the iterator-age threshold is derived unless the user supplies one.
 */
export function resolveStreamAlarmDefinitions(
  stream: IStream,
  config: StreamAlarmConfig | undefined,
  retentionPeriod: Duration | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const defaults: StreamAlarmDefaults = STREAM_ALARM_DEFAULTS;

  return STREAM_ALARM_KEYS.flatMap((key): AlarmDefinition[] => {
    const spec = STREAM_ALARM_SPECS[key];
    const userConfig = config?.[key];
    if (userConfig === false) return [];
    if (userConfig === undefined && !spec.enabledByDefault) return [];

    const baseline = defaults[key];
    let derivedThreshold: number | undefined;
    let basis = "";
    // A user-supplied threshold wins outright, so the retention period is only
    // consulted (and only warned about) when the threshold is derived.
    if (key === "getRecordsIteratorAgeMilliseconds" && userConfig?.threshold === undefined) {
      const derived = deriveIteratorAgeThreshold(stream, retentionPeriod);
      if (derived === undefined) return [];
      derivedThreshold = derived.threshold;
      basis = derived.basis;
    }

    const threshold = userConfig?.threshold ?? derivedThreshold ?? baseline?.threshold;
    if (threshold === undefined) {
      throw new Error(
        `Stream "${stream.node.id}": the "${key}" alarm has no generic default threshold — ` +
          `no value fits every workload. Supply one explicitly, e.g. ` +
          `recommendedAlarms({ ${key}: { threshold: … } }).`,
      );
    }

    const symbol = spec.comparisonOperator === ComparisonOperator.LESS_THAN_THRESHOLD ? "<" : ">";
    // An opt-in alarm with no baseline takes the sustained-condition defaults.
    const cfg = resolveAlarmConfig(userConfig, {
      ...SUSTAINED_FIVE_MINUTES,
      ...baseline,
      threshold,
    });
    return [
      {
        key,
        alarmName: cfg.alarmName,
        metric: spec.metric(stream),
        threshold: cfg.threshold,
        comparisonOperator: spec.comparisonOperator,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description:
          `${spec.summary} Threshold: ${symbol} ` +
          `${String(cfg.threshold)}${spec.unit ?? ""}${basis}, for ` +
          `${String(cfg.datapointsToAlarm)} of ${String(cfg.evaluationPeriods)} ` +
          `${METRIC_PERIOD_LABEL} periods.`,
      },
    ];
  });
}

/**
 * Creates the CloudWatch alarms for a Kinesis data stream: the AWS-recommended
 * alarms selected by `config`, followed by any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param stream - The stream to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param retentionPeriod - The stream's merged `retentionPeriod`; see
 *   {@link resolveStreamAlarmDefinitions}.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export function createStreamAlarms(
  scope: IConstruct,
  id: string,
  stream: IStream,
  config: StreamAlarmConfig | false | undefined,
  retentionPeriod: Duration | undefined,
  customAlarms: AlarmDefinitionBuilder<IStream>[] = [],
): Record<string, Alarm> {
  const recommended =
    config === false ? [] : resolveStreamAlarmDefinitions(stream, config, retentionPeriod);
  const custom = customAlarms.map((b) => b.resolve(stream));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
