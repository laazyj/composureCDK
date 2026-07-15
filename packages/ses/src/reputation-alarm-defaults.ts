import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface ReputationAlarmDefaults {
  enabled: true;
  bounceRate: AlarmConfigDefaults;
  complaintRate: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for account-level SES reputation.
 *
 * `treatMissingData` is `IGNORE` ("maintain the alarm state") on AWS's explicit
 * recommendation — reputation metrics only appear once the first bounce/complaint
 * occurs, so missing data must not be read as a breach or reset the state.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html
 */
export const REPUTATION_ALARM_DEFAULTS: ReputationAlarmDefaults = {
  enabled: true,

  /** SES reviews the account at a 5% bounce rate; alarm at that boundary. */
  bounceRate: {
    threshold: 0.05,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.IGNORE,
  },

  /** SES reviews the account at a 0.1% complaint rate; alarm at that boundary. */
  complaintRate: {
    threshold: 0.001,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.IGNORE,
  },
};
