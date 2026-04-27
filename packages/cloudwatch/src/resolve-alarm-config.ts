import type { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig, AlarmConfigDefaults } from "./alarm-config.js";
import type { AlarmName } from "./alarm-name.js";

/**
 * A fully-resolved alarm configuration. Every numeric/enum field is required;
 * `alarmName` is carried through verbatim from user config (or `undefined`
 * when the consumer is happy with the library default).
 *
 * Produced by {@link resolveAlarmConfig} after merging user overrides onto
 * defaults.
 */
export interface ResolvedAlarmConfig {
  alarmName?: AlarmName;
  threshold: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  treatMissingData: TreatMissingData;
}

/**
 * Resolves an absolute-threshold alarm config by layering user overrides
 * onto the defaults. `alarmName` is propagated from user config only;
 * defaults intentionally do not specify a name.
 */
export function resolveAlarmConfig(
  userConfig: AlarmConfig | undefined,
  defaults: AlarmConfigDefaults,
): ResolvedAlarmConfig {
  return {
    alarmName: userConfig?.alarmName,
    threshold: userConfig?.threshold ?? defaults.threshold,
    evaluationPeriods: userConfig?.evaluationPeriods ?? defaults.evaluationPeriods,
    datapointsToAlarm: userConfig?.datapointsToAlarm ?? defaults.datapointsToAlarm,
    treatMissingData: userConfig?.treatMissingData ?? defaults.treatMissingData,
  };
}
