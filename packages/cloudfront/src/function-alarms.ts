import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { Function as CfFunction } from "aws-cdk-lib/aws-cloudfront";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { FunctionAlarmConfig } from "./alarm-config.js";
import { FUNCTION_ALARM_DEFAULTS } from "./alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Creates a CloudFront Function metric with the correct namespace and
 * dimensions (FunctionName + Region=Global).
 *
 * CloudFront Function metrics are only emitted to the `us-east-1` region.
 * Consumers should deploy their alarms to that region.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
 */
function functionMetric(fn: CfFunction, metricName: string, statistic: string): Metric {
  return new Metric({
    namespace: "AWS/CloudFront",
    metricName,
    dimensionsMap: {
      FunctionName: fn.functionName,
      Region: "Global",
    },
    statistic,
    period: METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a CloudFront Function.
 */
export function resolveFunctionAlarmDefinitions(
  fn: CfFunction,
  config: FunctionAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.executionErrors !== false) {
    const cfg = resolveAlarmConfig(
      config?.executionErrors,
      FUNCTION_ALARM_DEFAULTS.executionErrors,
    );
    definitions.push({
      key: "executionErrors",
      metric: functionMetric(fn, "FunctionExecutionErrors", Stats.SUM),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront Function is raising execution errors. Threshold: > ${String(cfg.threshold)} errors in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.validationErrors !== false) {
    const cfg = resolveAlarmConfig(
      config?.validationErrors,
      FUNCTION_ALARM_DEFAULTS.validationErrors,
    );
    definitions.push({
      key: "validationErrors",
      metric: functionMetric(fn, "FunctionValidationErrors", Stats.SUM),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront Function is producing validation errors. Threshold: > ${String(cfg.threshold)} errors in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.throttles !== false) {
    const cfg = resolveAlarmConfig(config?.throttles, FUNCTION_ALARM_DEFAULTS.throttles);
    definitions.push({
      key: "throttles",
      metric: functionMetric(fn, "FunctionThrottles", Stats.SUM),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront Function is being throttled — likely exceeding its 1ms compute budget. Threshold: > ${String(cfg.threshold)} throttles in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates recommended CloudWatch alarms for a CloudFront Function, merging
 * recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param fn - The CloudFront Function to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
 */
export function createFunctionAlarms(
  scope: IConstruct,
  id: string,
  fn: CfFunction,
  config: FunctionAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<CfFunction>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? FUNCTION_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveFunctionAlarmDefinitions(fn, config);
  const custom = customAlarms.map((b) => b.resolve(fn));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
