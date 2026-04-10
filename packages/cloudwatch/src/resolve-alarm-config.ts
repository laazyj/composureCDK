import type { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig } from "./alarm-config.js";

/**
 * A fully-resolved alarm configuration where every field is required.
 * Produced by {@link resolveAlarmConfig} after merging user overrides
 * onto defaults.
 */
export interface ResolvedAlarmConfig {
  threshold: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  treatMissingData: TreatMissingData;
}

/**
 * Resolves an absolute-threshold alarm config by layering user overrides
 * onto the defaults.
 */
export function resolveAlarmConfig(
  userConfig: AlarmConfig | undefined,
  defaults: Required<AlarmConfig>,
): ResolvedAlarmConfig {
  return {
    threshold: userConfig?.threshold ?? defaults.threshold,
    evaluationPeriods: userConfig?.evaluationPeriods ?? defaults.evaluationPeriods,
    datapointsToAlarm: userConfig?.datapointsToAlarm ?? defaults.datapointsToAlarm,
    treatMissingData: userConfig?.treatMissingData ?? defaults.treatMissingData,
  };
}
