import { Duration } from "aws-cdk-lib";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface KeyAlarmDefaults {
  enabled: true;
  keyMaterialExpiration: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for KMS keys.
 *
 * `enabled` is the master switch for the recommended set and defaults on. The
 * `keyMaterialExpiration` alarm itself is opt-in — see
 * {@link KeyAlarmConfig.keyMaterialExpiration} — so these values apply once it
 * is switched on.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html
 */
export const KEY_ALARM_DEFAULTS: KeyAlarmDefaults = {
  enabled: true,

  /**
   * Alarm 30 days before imported key material expires — the window AWS uses
   * in its own worked example, and enough time to schedule a re-import of the
   * same material through whatever change process owns it.
   *
   * The metric is a countdown in seconds, so the threshold is one too.
   *
   * `treatMissingData: ignore` keeps the alarm latched at its last state
   * across gaps: KMS stops publishing the metric once the material has
   * actually expired, and `notBreaching` would quietly clear the alarm at
   * exactly the moment the key stopped working.
   */
  keyMaterialExpiration: {
    threshold: Duration.days(30).toSeconds(),
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.IGNORE,
  },
};
