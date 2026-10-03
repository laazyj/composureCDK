import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { ANY_OCCURRENCE } from "./alarm-defaults.js";

interface StateMachineAlarmDefaults {
  enabled: true;
  executionsFailed: AlarmConfigDefaults;
  executionsTimedOut: AlarmConfigDefaults;
  executionThrottled: AlarmConfigDefaults;
}

/**
 * Default alarm configuration for state machines — see {@link StateMachineAlarmConfig}.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-metrics-and-alerts.html
 */
export const STATE_MACHINE_ALARM_DEFAULTS: StateMachineAlarmDefaults = {
  enabled: true,
  executionsFailed: ANY_OCCURRENCE,
  executionsTimedOut: ANY_OCCURRENCE,
  executionThrottled: ANY_OCCURRENCE,
};
