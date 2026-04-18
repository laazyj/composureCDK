import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an ACM certificate.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CertificateManager
 */
export interface CertificateAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the certificate is approaching expiry.
   *
   * ACM public certificates auto-renew, so this alarm is primarily a
   * safety net for the edge cases where renewal cannot complete (for
   * example, when DNS validation records have been removed from the
   * zone). For imported certificates, which do not auto-renew, this
   * alarm is the primary expiry control.
   *
   * Metric: `AWS/CertificateManager DaysToExpiry`, statistic Minimum,
   * period 1 day, dimension `CertificateArn`.
   * Default threshold: &le; 45 days.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CertificateManager
   */
  daysToExpiry?: AlarmConfig | false;
}
