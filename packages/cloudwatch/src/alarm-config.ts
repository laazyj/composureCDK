import type { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmName } from "./alarm-name.js";

/**
 * Configuration for a single recommended CloudWatch alarm.
 * Every field has a documented default; users override individual
 * fields to tune thresholds without replacing the entire alarm.
 */
export interface AlarmConfig {
  /**
   * Explicit CloudWatch alarm name. When omitted, the library derives a
   * readable default from the stack name, builder id, and alarm key.
   *
   * Construct via the {@link alarmName} helper to opt into the same
   * validation the library applies to its own auto-generated names.
   */
  alarmName?: AlarmName;

  /** Alarm threshold. Default varies per alarm type. */
  threshold?: number;

  /** Number of evaluation periods before triggering. @default 1 */
  evaluationPeriods?: number;

  /** Datapoints within evaluation periods required to trigger. @default 1 */
  datapointsToAlarm?: number;

  /** How to treat missing data points. @default TreatMissingData.NOT_BREACHING */
  treatMissingData?: TreatMissingData;
}

/**
 * Type for per-package `*_ALARM_DEFAULTS` constants. Defaults set every
 * tunable field but never `alarmName` — names are derived per-instance.
 */
export type AlarmConfigDefaults = Required<Omit<AlarmConfig, "alarmName">>;
