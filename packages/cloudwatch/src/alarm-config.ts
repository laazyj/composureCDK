import type { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";

/**
 * Configuration for a single recommended CloudWatch alarm.
 * Every field has a documented default; users override individual
 * fields to tune thresholds without replacing the entire alarm.
 */
export interface AlarmConfig {
  /** Alarm threshold. Default varies per alarm type. */
  threshold?: number;

  /** Number of evaluation periods before triggering. @default 1 */
  evaluationPeriods?: number;

  /** Datapoints within evaluation periods required to trigger. @default 1 */
  datapointsToAlarm?: number;

  /** How to treat missing data points. @default TreatMissingData.NOT_BREACHING */
  treatMissingData?: TreatMissingData;
}
