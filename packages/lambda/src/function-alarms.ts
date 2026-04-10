import { Duration } from "aws-cdk-lib";
import {
  type Alarm,
  ComparisonOperator,
  Stats,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import type { Function as LambdaFunction, FunctionProps } from "aws-cdk-lib/aws-lambda";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { FunctionAlarmConfig, PercentageAlarmConfig } from "./alarm-config.js";
import { FUNCTION_ALARM_DEFAULTS } from "./alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s, applying contextual logic for timeout-based
 * duration and reserved-concurrency-based concurrent execution alarms.
 */
export function resolveFunctionAlarmDefinitions(
  fn: LambdaFunction,
  config: FunctionAlarmConfig | undefined,
  props: Pick<FunctionProps, "timeout" | "reservedConcurrentExecutions">,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.errors !== false) {
    const cfg = resolveAlarmConfig(config?.errors, FUNCTION_ALARM_DEFAULTS.errors);
    definitions.push({
      key: "errors",
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
      metric: fn.metricThrottles({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Lambda function invocations are being throttled. Threshold: > ${String(cfg.threshold)} throttles in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  const timeoutMs = props.timeout?.toMilliseconds();
  if (config?.duration !== false && timeoutMs !== undefined) {
    const cfg = resolvePercentageAlarmConfig(config?.duration, FUNCTION_ALARM_DEFAULTS.duration);
    const threshold = Math.round(timeoutMs * cfg.thresholdPercent);
    definitions.push({
      key: "duration",
      metric: fn.metricDuration({ period: METRIC_PERIOD, statistic: Stats.percentile(99) }),
      threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Lambda function p99 duration is approaching the configured timeout. Threshold: > ${String(threshold)}ms (${String(cfg.thresholdPercent * 100)}% of ${String(timeoutMs)}ms timeout).`,
    });
  }

  const reservedConcurrency = props.reservedConcurrentExecutions;
  if (config?.concurrentExecutions !== false && reservedConcurrency !== undefined) {
    const cfg = resolvePercentageAlarmConfig(
      config?.concurrentExecutions,
      FUNCTION_ALARM_DEFAULTS.concurrentExecutions,
    );
    const threshold = Math.round(reservedConcurrency * cfg.thresholdPercent);
    definitions.push({
      key: "concurrentExecutions",
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

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for a Lambda function,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param fn - The Lambda function to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param props - The merged function props, used for contextual alarm thresholds.
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
  customAlarms: AlarmDefinitionBuilder<LambdaFunction>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? FUNCTION_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveFunctionAlarmDefinitions(fn, config, props);
  const custom = customAlarms.map((b) => b.resolve(fn));

  return createAlarms(scope, id, [...recommended, ...custom]);
}

interface ResolvedPercentageAlarmConfig {
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
  defaults: Required<PercentageAlarmConfig>,
): ResolvedPercentageAlarmConfig {
  const thresholdPercent = userConfig?.thresholdPercent ?? defaults.thresholdPercent;

  if (thresholdPercent <= 0 || thresholdPercent > 1) {
    throw new Error(
      `thresholdPercent must be between 0 (exclusive) and 1 (inclusive), got ${String(thresholdPercent)}.`,
    );
  }

  return {
    thresholdPercent,
    evaluationPeriods: userConfig?.evaluationPeriods ?? defaults.evaluationPeriods,
    datapointsToAlarm: userConfig?.datapointsToAlarm ?? defaults.datapointsToAlarm,
    treatMissingData: userConfig?.treatMissingData ?? defaults.treatMissingData,
  };
}
