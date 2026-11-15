import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

/**
 * Default configuration of each rule's recommended alarms. AWS publishes no
 * recommended alarms for WAF, so these are this library's starting points.
 * Both treat missing data as not breaching, because WAF publishes a
 * datapoint only when its value is non-zero.
 */
export const WEB_ACL_RULE_ALARM_DEFAULTS = {
  /**
   * Any block in a 5-minute period. A rule you wrote encodes your own
   * contract — a credential every caller should send, a rate no client
   * should reach — so a single block is worth a look. Raise the threshold
   * on a rule that blocks routinely.
   */
  blockedRequests: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * Fewer than 30 days before a pinned version expires, which leaves time to
   * test and move to a newer one.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-managed-rule-groups-best-practice.html
   */
  daysToExpiry: {
    threshold: 30,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
} satisfies Record<string, AlarmConfigDefaults>;
