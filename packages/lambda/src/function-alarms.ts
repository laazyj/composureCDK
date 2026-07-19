import { Duration } from "aws-cdk-lib";
import {
  type Alarm,
  ComparisonOperator,
  Metric,
  Stats,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import type { Function as LambdaFunction, FunctionProps } from "aws-cdk-lib/aws-lambda";
import type { IConstruct } from "constructs";
import type { AlarmDefinition, AlarmName } from "@composurecdk/cloudwatch";
import {
  AlarmDefinitionBuilder,
  createAlarms,
  resolveAlarmConfig,
  resolveAlarmThresholdBasis,
} from "@composurecdk/cloudwatch";
import type {
  FunctionAlarmConfig,
  PercentageAlarmConfig,
  PercentageAlarmConfigDefaults,
} from "./alarm-config.js";
import { FUNCTION_ALARM_DEFAULTS } from "./alarm-defaults.js";
import type { AttachedEventSource } from "./event-sources/composure-event-source.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/** One contextual alarm derived from a per-mapping ESM metric. */
interface EventSourceAlarmSpec {
  /** Suffix appended to the event source key to form the alarm key. */
  keySuffix: string;
  /** `FunctionAlarmConfig` field tuning this alarm. */
  configKey: "eventSourceFailedInvocations" | "eventSourceDroppedEvents";
  metricName: string;
  describe: (eventSourceKey: string, threshold: number) => string;
}

/**
 * Contextual alarm specs keyed by source kind: each attached event source
 * of a kind contributes one alarm per spec, dimensioned on its mapping UUID.
 *
 * @see https://aws.amazon.com/blogs/compute/introducing-new-event-source-mapping-esm-metrics-for-aws-lambda/
 */
/**
 * Per-mapping ESM alarms shared by every kind that emits the `EventCount`
 * metrics — both SQS and DynamoDB streams report `FailedInvokeEventCount` and
 * `DroppedEventCount` when the mapping opts into `MetricType.EVENT_COUNT`.
 */
const ESM_EVENT_COUNT_SPECS: EventSourceAlarmSpec[] = [
  {
    keySuffix: "FailedInvocations",
    configKey: "eventSourceFailedInvocations",
    metricName: "FailedInvokeEventCount",
    describe: (key, threshold) =>
      `Lambda event source "${key}" is failing to invoke the function. ` +
      `Threshold: > ${String(threshold)} failed invocations in ${METRIC_PERIOD_LABEL}.`,
  },
  {
    keySuffix: "DroppedEvents",
    configKey: "eventSourceDroppedEvents",
    metricName: "DroppedEventCount",
    describe: (key, threshold) =>
      `Lambda event source "${key}" is dropping events after exhausting retries or TTL. ` +
      `Threshold: > ${String(threshold)} dropped events in ${METRIC_PERIOD_LABEL}.`,
  },
];

const EVENT_SOURCE_ALARM_SPECS: Record<AttachedEventSource["kind"], EventSourceAlarmSpec[]> = {
  sqs: ESM_EVENT_COUNT_SPECS,
  dynamodb: ESM_EVENT_COUNT_SPECS,
  unknown: [],
};

/**
 * Source kinds backed by a stream, for which the function-level `IteratorAge`
 * alarm is created. Extensible to `"kinesis"` when that source lands.
 */
const STREAM_EVENT_SOURCE_KINDS: ReadonlySet<AttachedEventSource["kind"]> = new Set(["dynamodb"]);

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s, applying contextual logic for timeout-based
 * duration and reserved-concurrency-based concurrent execution alarms.
 */
export function resolveFunctionAlarmDefinitions(
  fn: LambdaFunction,
  config: FunctionAlarmConfig | undefined,
  props: Pick<FunctionProps, "timeout" | "reservedConcurrentExecutions">,
  eventSources: AttachedEventSource[] = [],
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.errors !== false) {
    const cfg = resolveAlarmConfig(config?.errors, FUNCTION_ALARM_DEFAULTS.errors);
    definitions.push({
      key: "errors",
      alarmName: cfg.alarmName,
      metric: fn.metricErrors({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Lambda function is producing invocation errors. Threshold: > ${String(cfg.threshold)} errors in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.throttles !== false) {
    const cfg = resolveAlarmConfig(config?.throttles, FUNCTION_ALARM_DEFAULTS.throttles);
    definitions.push({
      key: "throttles",
      alarmName: cfg.alarmName,
      metric: fn.metricThrottles({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Lambda function invocations are being throttled. Threshold: > ${String(cfg.threshold)} throttles in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  // Threshold is a percentage of the timeout, so it needs a concrete `Duration`.
  // Check the `duration !== false` escape hatch *before* touching the timeout, so
  // disabling always works even when the conversion below would throw. The shared
  // helper then omits the alarm (and warns) for a token-valued timeout, which has
  // no millisecond threshold at synth time.
  if (config?.duration !== false) {
    const timeoutMs = resolveAlarmThresholdBasis({
      scope: fn,
      value: props.timeout,
      isUnresolved: (timeout) => timeout.isUnresolved(),
      resolve: (timeout) => timeout.toMilliseconds(),
      warningId: "@composurecdk/lambda:token-timeout-duration-alarm",
      alarmLabel: "Lambda duration",
      suppressHint: "recommendedAlarms({ duration: false })",
    });
    if (timeoutMs !== undefined) {
      const cfg = resolvePercentageAlarmConfig(config?.duration, FUNCTION_ALARM_DEFAULTS.duration);
      const threshold = Math.round(timeoutMs * cfg.thresholdPercent);
      definitions.push({
        key: "duration",
        alarmName: cfg.alarmName,
        metric: fn.metricDuration({ period: METRIC_PERIOD, statistic: Stats.percentile(99) }),
        threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: `Lambda function p99 duration is approaching the configured timeout. Threshold: > ${String(threshold)}ms (${String(cfg.thresholdPercent * 100)}% of ${String(timeoutMs)}ms timeout).`,
      });
    }
  }

  // Same shape, against a raw number. A token-valued `reservedConcurrentExecutions`
  // wouldn't throw but would yield a meaningless threshold, so the helper skips it
  // (default `Token.isUnresolved` guard).
  if (config?.concurrentExecutions !== false) {
    const reservedConcurrency = resolveAlarmThresholdBasis({
      scope: fn,
      value: props.reservedConcurrentExecutions,
      resolve: (reserved) => reserved,
      warningId: "@composurecdk/lambda:token-reserved-concurrency-alarm",
      alarmLabel: "Lambda concurrent-executions",
      suppressHint: "recommendedAlarms({ concurrentExecutions: false })",
    });
    if (reservedConcurrency !== undefined) {
      const cfg = resolvePercentageAlarmConfig(
        config?.concurrentExecutions,
        FUNCTION_ALARM_DEFAULTS.concurrentExecutions,
      );
      const threshold = Math.round(reservedConcurrency * cfg.thresholdPercent);
      definitions.push({
        key: "concurrentExecutions",
        alarmName: cfg.alarmName,
        metric: fn.metric("ConcurrentExecutions", {
          period: METRIC_PERIOD,
          statistic: Stats.MAXIMUM,
        }),
        threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: `Lambda function concurrent executions approaching reserved concurrency limit. Threshold: >= ${String(threshold)} (${String(cfg.thresholdPercent * 100)}% of ${String(reservedConcurrency)} reserved).`,
      });
    }
  }

  for (const eventSource of eventSources) {
    // The ESM metrics that back these alarms are dimensioned on the mapping
    // UUID; without it (e.g. a bare escape-hatch source) there is nothing to
    // alarm on.
    if (eventSource.eventSourceMappingId === undefined) continue;

    for (const spec of EVENT_SOURCE_ALARM_SPECS[eventSource.kind]) {
      const userConfig = config?.[spec.configKey];
      if (userConfig === false) continue;

      const cfg = resolveAlarmConfig(userConfig, FUNCTION_ALARM_DEFAULTS[spec.configKey]);
      definitions.push({
        key: `${eventSource.key}${spec.keySuffix}`,
        alarmName: cfg.alarmName,
        metric: eventSourceMetric(eventSource.eventSourceMappingId, spec.metricName),
        threshold: cfg.threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: spec.describe(eventSource.key, cfg.threshold),
      });
    }
  }

  // `IteratorAge` is a function-level metric (dimensioned on `FunctionName`,
  // not the mapping UUID), so it cannot ride the per-mapping loop above: one
  // alarm covers the function whenever any stream source is attached.
  if (
    config?.eventSourceIteratorAge !== false &&
    eventSources.some((es) => STREAM_EVENT_SOURCE_KINDS.has(es.kind))
  ) {
    const cfg = resolveAlarmConfig(
      config?.eventSourceIteratorAge,
      FUNCTION_ALARM_DEFAULTS.eventSourceIteratorAge,
    );
    definitions.push({
      key: "iteratorAge",
      alarmName: cfg.alarmName,
      metric: new Metric({
        namespace: "AWS/Lambda",
        metricName: "IteratorAge",
        dimensionsMap: { FunctionName: fn.functionName },
        statistic: Stats.MAXIMUM,
        period: METRIC_PERIOD,
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `Lambda function is falling behind its stream event source (IteratorAge). ` +
        `Threshold: > ${String(cfg.threshold)}ms for ${String(cfg.evaluationPeriods)} consecutive ${METRIC_PERIOD_LABEL} periods.`,
    });
  }

  return definitions;
}

/**
 * Builds an `AWS/Lambda` event source mapping metric. These per-mapping ESM
 * metrics are dimensioned on `EventSourceMappingUUID` rather than
 * `FunctionName`, so they cannot use the function's built-in metric helpers.
 */
function eventSourceMetric(eventSourceMappingId: string, metricName: string): Metric {
  return new Metric({
    namespace: "AWS/Lambda",
    metricName,
    dimensionsMap: { EventSourceMappingUUID: eventSourceMappingId },
    statistic: Stats.SUM,
    period: METRIC_PERIOD,
  });
}

/**
 * Creates AWS-recommended CloudWatch alarms for a Lambda function,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param fn - The Lambda function to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param props - The merged function props, used for contextual alarm thresholds.
 * @param eventSources - Event sources attached to the function, used for
 *   per-event-source contextual alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
 */
export function createFunctionAlarms(
  scope: IConstruct,
  id: string,
  fn: LambdaFunction,
  config: FunctionAlarmConfig | false | undefined,
  props: Pick<FunctionProps, "timeout" | "reservedConcurrentExecutions">,
  eventSources: AttachedEventSource[] = [],
  customAlarms: AlarmDefinitionBuilder<LambdaFunction>[] = [],
): Record<string, Alarm> {
  const recommended =
    config === false || config?.enabled === false
      ? []
      : resolveFunctionAlarmDefinitions(fn, config, props, eventSources);
  const custom = customAlarms.map((b) => b.resolve(fn));

  return createAlarms(scope, id, [...recommended, ...custom]);
}

interface ResolvedPercentageAlarmConfig {
  alarmName?: AlarmName;
  thresholdPercent: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  treatMissingData: TreatMissingData;
}

/**
 * Resolves a percentage-based alarm config by layering user overrides
 * onto the defaults.
 */
function resolvePercentageAlarmConfig(
  userConfig: PercentageAlarmConfig | undefined,
  defaults: PercentageAlarmConfigDefaults,
): ResolvedPercentageAlarmConfig {
  const thresholdPercent = userConfig?.thresholdPercent ?? defaults.thresholdPercent;

  if (thresholdPercent <= 0 || thresholdPercent > 1) {
    throw new Error(
      `thresholdPercent must be between 0 (exclusive) and 1 (inclusive), got ${String(thresholdPercent)}.`,
    );
  }

  return {
    alarmName: userConfig?.alarmName,
    thresholdPercent,
    evaluationPeriods: userConfig?.evaluationPeriods ?? defaults.evaluationPeriods,
    datapointsToAlarm: userConfig?.datapointsToAlarm ?? defaults.datapointsToAlarm,
    treatMissingData: userConfig?.treatMissingData ?? defaults.treatMissingData,
  };
}
