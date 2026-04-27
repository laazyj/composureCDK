import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { Function as CfFunction, FunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { FunctionAlarmConfig } from "./alarm-config.js";
import { FUNCTION_ALARM_DEFAULTS } from "./alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * CloudFront Function metrics are emitted in the `us-east-1` region only
 * (CloudFront is a global service). Metric dimensions are
 * `FunctionName` + `Region=Global`.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
 */
function functionMetric(fn: CfFunction, metricName: string): Metric {
  return new Metric({
    namespace: "AWS/CloudFront",
    metricName,
    dimensionsMap: {
      FunctionName: fn.functionName,
      Region: "Global",
    },
    statistic: Stats.SUM,
    period: METRIC_PERIOD,
  });
}

/**
 * Converts a CloudFront cache-behavior path pattern into a PascalCase slug
 * suitable for alarm keys and CDK construct ids. A single leading `/` is
 * dropped (the common case), interior `/` becomes `Slash` so sibling patterns
 * don't collide, `*` becomes `Star`, and `?` becomes `Q`. Other
 * non-alphanumeric characters are stripped.
 *
 * Examples:
 * - `/api/*` → `ApiSlashStar`
 * - `/api*`  → `ApiStar` (distinct from `/api/*`)
 * - `*.html` → `StarHtml`
 * - `images/*` → `ImagesSlashStar`
 *
 * @internal
 */
export function pathPatternSlug(pattern: string): string {
  const stripped = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  return stripped
    .replace(/\//g, " Slash ")
    .replace(/\*/g, " Star ")
    .replace(/\?/g, " Q ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Converts a {@link FunctionEventType} value (e.g. `"viewer-request"`) into
 * PascalCase (e.g. `"ViewerRequest"`) for use in alarm keys and construct ids.
 *
 * @internal
 */
export function eventTypePascal(eventType: FunctionEventType): string {
  return eventType
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Builds the prefix used for every alarm key produced for a given inline
 * function — e.g. `defaultBehaviorViewerRequest` or `behaviorApiStarViewerRequest`.
 * Pass `null` for the default behavior.
 *
 * @internal
 */
export function behaviorFunctionKeyPrefix(
  pathPattern: string | null,
  eventType: FunctionEventType,
): string {
  const scope =
    pathPattern === null ? "defaultBehavior" : `behavior${pathPatternSlug(pathPattern)}`;
  return `${scope}${eventTypePascal(eventType)}`;
}

function behaviorFunctionScopeLabel(
  pathPattern: string | null,
  eventType: FunctionEventType,
): string {
  const scope = pathPattern === null ? "default behavior" : `behavior "${pathPattern}"`;
  return `${scope} (${eventType})`;
}

/**
 * Produces fully-resolved {@link AlarmDefinition}s for the three AWS-recommended
 * CloudFront Function alarms — execution errors, validation errors, throttles —
 * scoped to a single behavior + event type so the keys and descriptions stay
 * actionable when the same underlying function is used on multiple behaviors.
 *
 * @internal
 */
export function resolveBehaviorFunctionAlarmDefinitions(
  pathPattern: string | null,
  eventType: FunctionEventType,
  fn: CfFunction,
  config: FunctionAlarmConfig | false | undefined,
): AlarmDefinition[] {
  if (config === false) return [];
  if (config?.enabled === false) return [];

  const keyPrefix = behaviorFunctionKeyPrefix(pathPattern, eventType);
  const scopeLabel = behaviorFunctionScopeLabel(pathPattern, eventType);
  const definitions: AlarmDefinition[] = [];

  if (config?.executionErrors !== false) {
    const cfg = resolveAlarmConfig(
      config?.executionErrors,
      FUNCTION_ALARM_DEFAULTS.executionErrors,
    );
    definitions.push({
      key: `${keyPrefix}ExecutionErrors`,
      alarmName: cfg.alarmName,
      metric: functionMetric(fn, "FunctionExecutionErrors"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront Function on ${scopeLabel} is raising execution errors. Threshold: > ${String(cfg.threshold)} errors in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.validationErrors !== false) {
    const cfg = resolveAlarmConfig(
      config?.validationErrors,
      FUNCTION_ALARM_DEFAULTS.validationErrors,
    );
    definitions.push({
      key: `${keyPrefix}ValidationErrors`,
      alarmName: cfg.alarmName,
      metric: functionMetric(fn, "FunctionValidationErrors"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront Function on ${scopeLabel} is producing validation errors. Threshold: > ${String(cfg.threshold)} errors in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.throttles !== false) {
    const cfg = resolveAlarmConfig(config?.throttles, FUNCTION_ALARM_DEFAULTS.throttles);
    definitions.push({
      key: `${keyPrefix}Throttles`,
      alarmName: cfg.alarmName,
      metric: functionMetric(fn, "FunctionThrottles"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront Function on ${scopeLabel} is being throttled — likely exceeding its 1ms compute budget. Threshold: > ${String(cfg.threshold)} throttles in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}
