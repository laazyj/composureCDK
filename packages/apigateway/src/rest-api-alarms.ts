import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { RestApiBase } from "aws-cdk-lib/aws-apigateway";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { RestApiAlarmConfig } from "./alarm-config.js";
import { REST_API_ALARM_DEFAULTS } from "./alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Creates an API Gateway metric with the correct namespace and
 * dimensions (ApiName + Stage).
 */
function apiMetric(api: RestApiBase, metricName: string, statistic: string): Metric {
  return new Metric({
    namespace: "AWS/ApiGateway",
    metricName,
    dimensionsMap: {
      ApiName: api.restApiName,
      Stage: api.deploymentStage.stageName,
    },
    statistic,
    period: METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an API Gateway REST API.
 */
export function resolveRestApiAlarmDefinitions(
  api: RestApiBase,
  config: RestApiAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.clientError !== false) {
    const cfg = resolveAlarmConfig(config?.clientError, REST_API_ALARM_DEFAULTS.clientError);
    definitions.push({
      key: "clientError",
      metric: apiMetric(api, "4XXError", Stats.AVERAGE),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `REST API client error rate is elevated. Threshold: > ${String(cfg.threshold * 100)}% of requests in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.serverError !== false) {
    const cfg = resolveAlarmConfig(config?.serverError, REST_API_ALARM_DEFAULTS.serverError);
    definitions.push({
      key: "serverError",
      metric: apiMetric(api, "5XXError", Stats.AVERAGE),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `REST API server error rate is elevated. Threshold: > ${String(cfg.threshold * 100)}% of requests in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.latency !== false) {
    const cfg = resolveAlarmConfig(config?.latency, REST_API_ALARM_DEFAULTS.latency);
    definitions.push({
      key: "latency",
      metric: apiMetric(api, "Latency", Stats.percentile(90)),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `REST API p90 latency is elevated. Threshold: >= ${String(cfg.threshold)}ms in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an API Gateway REST API,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param api - The REST API to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
 */
export function createRestApiAlarms(
  scope: IConstruct,
  id: string,
  api: RestApiBase,
  config: RestApiAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<RestApiBase>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? REST_API_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveRestApiAlarmDefinitions(api, config);
  const custom = customAlarms.map((b) => b.resolve(api));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
