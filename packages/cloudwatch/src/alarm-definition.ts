import type { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";

/**
 * A fully-resolved alarm descriptor. All fields are required —
 * this is the canonical form consumed by {@link createAlarms}.
 */
export interface AlarmDefinition {
  key: string;
  metric: Metric;
  threshold: number;
  comparisonOperator: ComparisonOperator;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  treatMissingData: TreatMissingData;
  description: string;
}
