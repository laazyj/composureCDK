import { Duration } from "aws-cdk-lib";
import {
  type Alarm,
  ComparisonOperator,
  type MathExpression,
  Metric,
  Stats,
} from "aws-cdk-lib/aws-cloudwatch";
import { type ITable, Operation } from "aws-cdk-lib/aws-dynamodb";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { TableAlarmConfig } from "./table-alarm-config.js";
import { TABLE_ALARM_DEFAULTS } from "./table-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Operations the default `systemErrors` alarm sums over. A CloudWatch alarm on
 * a metric-math expression may reference at most 10 individual metrics, and
 * DynamoDB defines 14 operations — so the full-table aggregate cannot be
 * alarmed directly. These ten are the core SDK data-plane operations (single
 * item, query/scan, batch, and transactions); the PartiQL statement operations
 * and the stream `GetRecords` operation are omitted. Override via a custom
 * `addAlarm` if your workload's error profile lives in the excluded set.
 */
const SYSTEM_ERROR_OPERATIONS: Operation[] = [
  Operation.GET_ITEM,
  Operation.BATCH_GET_ITEM,
  Operation.QUERY,
  Operation.SCAN,
  Operation.PUT_ITEM,
  Operation.UPDATE_ITEM,
  Operation.DELETE_ITEM,
  Operation.BATCH_WRITE_ITEM,
  Operation.TRANSACT_GET_ITEMS,
  Operation.TRANSACT_WRITE_ITEMS,
];

/**
 * Builds a table-scoped `AWS/DynamoDB` metric with the `TableName` dimension.
 */
function tableMetric(table: ITable, metricName: string): Metric {
  return new Metric({
    namespace: "AWS/DynamoDB",
    metricName,
    dimensionsMap: { TableName: table.tableName },
    statistic: Stats.SUM,
    period: METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a DynamoDB table.
 */
export function resolveTableAlarmDefinitions(
  table: ITable,
  config: TableAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.systemErrors !== false) {
    const cfg = resolveAlarmConfig(config?.systemErrors, TABLE_ALARM_DEFAULTS.systemErrors);
    definitions.push({
      key: "systemErrors",
      alarmName: cfg.alarmName,
      // metricSystemErrorsForOperations sums SystemErrors across the given
      // operations into a single MathExpression — the per-operation dimension
      // means there is no single plain Metric for "errors on this table".
      metric: table.metricSystemErrorsForOperations({
        period: METRIC_PERIOD,
        operations: SYSTEM_ERROR_OPERATIONS,
      }) as MathExpression,
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `DynamoDB table is returning server-side (HTTP 500) errors, summed across the core data-plane operations. ` +
        `Threshold: > ${String(cfg.threshold)} in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.readThrottleEvents !== false) {
    const cfg = resolveAlarmConfig(
      config?.readThrottleEvents,
      TABLE_ALARM_DEFAULTS.readThrottleEvents,
    );
    definitions.push({
      key: "readThrottleEvents",
      alarmName: cfg.alarmName,
      metric: tableMetric(table, "ReadThrottleEvents"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `DynamoDB table read requests are being throttled, indicating a hot partition or ` +
        `insufficient read capacity. Threshold: > ${String(cfg.threshold)} in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.writeThrottleEvents !== false) {
    const cfg = resolveAlarmConfig(
      config?.writeThrottleEvents,
      TABLE_ALARM_DEFAULTS.writeThrottleEvents,
    );
    definitions.push({
      key: "writeThrottleEvents",
      alarmName: cfg.alarmName,
      metric: tableMetric(table, "WriteThrottleEvents"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `DynamoDB table write requests are being throttled, indicating a hot partition or ` +
        `insufficient write capacity. Threshold: > ${String(cfg.threshold)} in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for a DynamoDB table, merging
 * recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param table - The DynamoDB table to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB
 */
export function createTableAlarms(
  scope: IConstruct,
  id: string,
  table: ITable,
  config: TableAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<ITable>[] = [],
): Record<string, Alarm> {
  const recommended =
    config === false || config?.enabled === false
      ? []
      : resolveTableAlarmDefinitions(table, config);
  const custom = customAlarms.map((b) => b.resolve(table));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
