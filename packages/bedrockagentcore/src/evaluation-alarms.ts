import { Duration, Token } from "aws-cdk-lib";
import type { DataSourceConfig, IOnlineEvaluationConfig } from "aws-cdk-lib/aws-bedrockagentcore";
import { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import {
  type AlarmConfig,
  type AlarmConfigDefaults,
  type AlarmDefinition,
  resolveAlarmConfig,
} from "@composurecdk/cloudwatch";
import type { AgentCoreMetricSource } from "./alarms.js";

/** Controls the recommended alarms for an online evaluation. */
export interface OnlineEvaluationAlarmConfig {
  /**
   * Alarm when an evaluator's average score falls below the threshold,
   * keyed by the evaluator's metric name, e.g. `Builtin.Helpfulness`.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec05.html
   */
  scores?: Record<string, AlarmConfig & { threshold: number }>;
}

/**
 * Scores arrive as sessions are evaluated, not every minute: alarm on 2 of 3
 * hourly averages below the threshold. No evaluations emit no data.
 */
export const ONLINE_EVALUATION_ALARM_DEFAULTS: Omit<AlarmConfigDefaults, "threshold"> = {
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

/** An online evaluation's hourly-average score metrics, named by evaluator. */
export function onlineEvaluationMetrics(
  onlineEvaluation: IOnlineEvaluationConfig,
  dataSource: DataSourceConfig,
): AgentCoreMetricSource {
  const [serviceName] = dataSource.cloudWatchLogsConfig.serviceNames;
  return {
    metric: (metricName, options) =>
      new Metric({
        namespace: "Bedrock-AgentCore/Evaluations",
        metricName,
        statistic: "Average",
        period: Duration.hours(1),
        ...options,
        dimensionsMap: {
          onlineEvaluationConfigId: onlineEvaluation.onlineEvaluationConfigId,
          "service.name": serviceName,
          ...options?.dimensionsMap,
        },
      }),
  };
}

/**
 * Resolves the score alarms. A key must name one of `evaluatorIds`, unless
 * some ids are only known at deploy time.
 */
export function resolveOnlineEvaluationAlarms(
  metrics: AgentCoreMetricSource,
  evaluatorIds: string[],
  config: OnlineEvaluationAlarmConfig | undefined,
): AlarmDefinition[] {
  const checkable = !evaluatorIds.some((evaluatorId) => Token.isUnresolved(evaluatorId));
  return Object.entries(config?.scores ?? {}).map(([evaluator, userConfig]) => {
    if (checkable && !evaluatorIds.includes(evaluator)) {
      throw new Error(
        `Score alarm "${evaluator}" names none of the evaluation's evaluators: ` +
          `${evaluatorIds.join(", ")}.`,
      );
    }
    const cfg = resolveAlarmConfig(userConfig, {
      ...ONLINE_EVALUATION_ALARM_DEFAULTS,
      threshold: userConfig.threshold,
    });
    return {
      key: evaluator,
      alarmName: cfg.alarmName,
      metric: metrics.metric(evaluator),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Average ${evaluator} score is below ${String(cfg.threshold)}.`,
    };
  });
}
