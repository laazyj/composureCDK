import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended account-level SES reputation alarms are created by
 * {@link createReputationAlarmBuilder}. Both alarms are enabled by default with
 * the AWS-recommended thresholds. Set an individual alarm to `false` to disable
 * it, or provide an {@link AlarmConfig} to tune its threshold.
 *
 * `Reputation.BounceRate` and `Reputation.ComplaintRate` are **account-level**,
 * dimensionless metrics, so these alarms monitor the whole account's sending
 * reputation in the Region — not any single configuration set or identity.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html
 */
export interface ReputationAlarmConfig {
  /**
   * Master switch: set to `false` to disable both recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the account's hard-bounce rate reaches the threshold. SES places
   * an account under review at 5% and may pause sending at 10%, so the default
   * fires at the review boundary to leave headroom.
   *
   * Metric: `AWS/SES Reputation.BounceRate`, statistic Average, period 1 hour.
   * Default threshold: `>= 0.05` (5%).
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/reputationdashboardmessages.html
   */
  bounceRate?: AlarmConfig | false;

  /**
   * Alarm when the account's complaint rate reaches the threshold. SES places an
   * account under review at 0.1% and may pause sending at 0.5%, so the default
   * fires at the review boundary.
   *
   * Metric: `AWS/SES Reputation.ComplaintRate`, statistic Average, period 1 hour.
   * Default threshold: `>= 0.001` (0.1%).
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/reputationdashboardmessages.html
   */
  complaintRate?: AlarmConfig | false;
}
