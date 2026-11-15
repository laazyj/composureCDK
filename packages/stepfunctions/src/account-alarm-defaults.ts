import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { ANY_OCCURRENCE } from "./alarm-defaults.js";

type WithoutThreshold = Omit<AlarmConfigDefaults, "threshold">;

interface AccountAlarmDefaults {
  enabled: true;
  openExecutions: WithoutThreshold & { thresholdPercent: number };
  openMapRuns: AlarmConfigDefaults;
  mapRunBacklog: WithoutThreshold;
  startExecutionThrottled: AlarmConfigDefaults;
  stateTransitionThrottled: AlarmConfigDefaults;
}

/** {@link ANY_OCCURRENCE}'s evaluation settings, for alarms with their own threshold. */
const SINGLE_DATAPOINT: WithoutThreshold = {
  evaluationPeriods: ANY_OCCURRENCE.evaluationPeriods,
  datapointsToAlarm: ANY_OCCURRENCE.datapointsToAlarm,
  treatMissingData: ANY_OCCURRENCE.treatMissingData,
};

/**
 * Default configuration for the account-level alarms. See
 * {@link AccountAlarmConfig}. `openExecutions` and `openMapRuns` use the
 * thresholds AWS recommends. The other three have no AWS guidance: they use
 * this package's "any occurrence" default, or, for `mapRunBacklog`, the
 * caller's threshold.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html
 */
export const ACCOUNT_ALARM_DEFAULTS: AccountAlarmDefaults = {
  enabled: true,
  openExecutions: { ...SINGLE_DATAPOINT, thresholdPercent: 0.1 },
  openMapRuns: { ...ANY_OCCURRENCE, threshold: 900 },
  mapRunBacklog: SINGLE_DATAPOINT,
  startExecutionThrottled: ANY_OCCURRENCE,
  stateTransitionThrottled: ANY_OCCURRENCE,
};
