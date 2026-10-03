import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface StateMachineAlarmDefaults {
  enabled: true;
  executionsFailed: AlarmConfigDefaults;
  executionsTimedOut: AlarmConfigDefaults;
  executionThrottled: AlarmConfigDefaults;
}

/** Alarm on the first occurrence; an idle state machine stays OK. */
const ANY_OCCURRENCE: AlarmConfigDefaults = {
  threshold: 0,
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

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
