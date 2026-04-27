import type { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmName } from "./alarm-name.js";

/**
 * A fully-resolved alarm descriptor. All fields are required —
 * this is the canonical form consumed by {@link createAlarms}.
 *
 * `alarmName` is the only optional field: when omitted, {@link createAlarms}
 * derives a default via `defaultAlarmName(scope, id, key)`.
 */
export interface AlarmDefinition {
  key: string;
  alarmName?: AlarmName;
  metric: Metric;
  threshold: number;
  comparisonOperator: ComparisonOperator;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  treatMissingData: TreatMissingData;
  description: string;
}
