import type {
  ComparisonOperator,
  MathExpression,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmName } from "./alarm-name.js";

/**
 * A metric an alarm can be created from: either a single {@link Metric} or a
 * {@link MathExpression} (e.g. a rate/ratio like `errors / invocations`).
 *
 * Both classes carry `createAlarm(...)` — it is declared on the concrete
 * classes, not on `IMetric` — so this union is exactly what {@link createAlarms}
 * needs to call. When using a `MathExpression`, set its `period` explicitly:
 * the expression overrides the period of every metric in `usingMetrics`.
 */
export type AlarmMetric = Metric | MathExpression;

/**
 * A fully-resolved alarm descriptor. All fields are required —
 * this is the canonical form consumed by {@link createAlarms}.
 *
 * `alarmName` and `constructId` are the optional fields:
 * - `alarmName`: when omitted, {@link createAlarms} derives a default via
 *   `defaultAlarmName(scope, id, key)`.
 * - `constructId`: when omitted, {@link createAlarms} derives the construct id
 *   as `` `${id}${Capitalize(key)}Alarm` ``.
 */
export interface AlarmDefinition {
  key: string;
  alarmName?: AlarmName;
  constructId?: string;
  metric: AlarmMetric;
  threshold: number;
  comparisonOperator: ComparisonOperator;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  treatMissingData: TreatMissingData;
  description: string;
}
