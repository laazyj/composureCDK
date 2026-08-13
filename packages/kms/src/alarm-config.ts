import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a KMS key.
 *
 * Unlike the other builder packages, the single AWS-recommended KMS alarm is
 * **opt-in**: `SecondsUntilKeyMaterialExpiration` is only published for keys
 * whose key material was imported with an expiration date, so on a key created
 * by CloudFormation it would never leave `INSUFFICIENT_DATA`. Set
 * {@link keyMaterialExpiration} to `true` (or to an {@link AlarmConfig}) on a
 * key you import material into.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html
 */
export interface KeyAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when imported key material is approaching its expiration time.
   *
   * When key material expires, AWS KMS deletes it and the key becomes
   * unusable — every ciphertext under it is undecryptable until the same
   * material is re-imported. The alarm is the notice to re-import.
   *
   * Metric: `AWS/KMS SecondsUntilKeyMaterialExpiration`, statistic Minimum,
   * dimension `KeyId`. Default threshold: &le; 30 days, expressed in seconds.
   *
   * Only meaningful for a key with imported, expiring key material — hence
   * `false` by default. Pass `true` to create it with the AWS-recommended
   * settings, or an {@link AlarmConfig} to tune the threshold.
   *
   * @default false
   * @see https://docs.aws.amazon.com/kms/latest/developerguide/imported-key-material-expiration-alarm.html
   */
  keyMaterialExpiration?: AlarmConfig | boolean;
}
