import { ComparisonOperator, type Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmDefinition, ResolvedAlarmConfig } from "@composurecdk/cloudwatch";

/** A greater-than alarm definition from a resolved config. @internal */
export function toDefinition(
  key: string,
  metric: Metric,
  cfg: ResolvedAlarmConfig,
  description: string,
): AlarmDefinition {
  return {
    key,
    alarmName: cfg.alarmName,
    metric,
    threshold: cfg.threshold,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: cfg.evaluationPeriods,
    datapointsToAlarm: cfg.datapointsToAlarm,
    treatMissingData: cfg.treatMissingData,
    description,
  };
}
