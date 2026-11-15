import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls the web ACL's recommended alarms. They are per rule — see
 * {@link WebAclRuleAlarmConfig} — so this is the master switch.
 */
export interface WebAclAlarmConfig {
  /**
   * Set to `false` to create none of the recommended alarms. Alarms added
   * with `addAlarm()` are unaffected.
   * @default true
   */
  enabled?: boolean;
}

/**
 * Controls one rule's recommended alarms, set with the rule builder's
 * `.alarms()`. Set an alarm to `false` to disable it, or to an
 * {@link AlarmConfig} to enable it (if off by default) or tune it. Defaults
 * are in {@link WEB_ACL_RULE_ALARM_DEFAULTS}.
 *
 * Every alarm treats missing data as not breaching: WAF publishes a
 * datapoint only when the count is non-zero.
 *
 * AWS publishes no recommended alarms for WAF, so the thresholds are this
 * library's starting points.
 */
export interface WebAclRuleAlarmConfig {
  /**
   * Set to `false` to disable all of this rule's recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the rule blocks requests: `BlockedRequests` (Sum, 5 minutes)
   * above the threshold.
   *
   * On by default for a rule you wrote whose action is Block, where a block
   * is a signal — a throttled client, a request missing its credentials.
   * Off by default for a rule-group rule, whose managed rules block internet
   * background noise all day; pass an {@link AlarmConfig} to turn it on.
   * Never created for a rule that does not block.
   *
   * Default threshold: > 0 blocked requests in one 5-minute period.
   */
  blockedRequests?: AlarmConfig | false;

  /**
   * Alarm when a pinned managed rule group version is about to expire:
   * `DaysToExpiry` (Minimum, 1 hour) below the threshold. Once a version
   * expires, WAF rejects every update to the web ACL that does not move
   * the group to a current version.
   *
   * On by default for a managed rule group with a `version`; never created
   * otherwise.
   *
   * Default threshold: < 30 days.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-managed-rule-groups-versioning-expiration.html
   */
  daysToExpiry?: AlarmConfig | false;
}
