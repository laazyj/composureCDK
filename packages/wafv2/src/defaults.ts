import type { WebAclLoggingFilter } from "./logging-filter.js";

/**
 * Defaults for {@link createWebAclBuilder}. Each can be overridden through the
 * builder's fluent API.
 */
export const WEB_ACL_DEFAULTS = {
  /**
   * Regional, for API Gateway, Application Load Balancers, AppSync, Cognito,
   * App Runner and Verified Access. A web ACL for CloudFront must say
   * `.scope("CLOUDFRONT")` and be deployed in `us-east-1`.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html
   */
  scope: "REGIONAL",

  /**
   * Off, because a sampled request keeps every header, including the
   * credentials that logging redacts. Turn it on only with a
   * `dataProtectionConfig`, which does apply to samples.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-data-protection-and-logging.html
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_data_classification_define_protection.html
   */
  sampledRequests: false,

  /**
   * On, to a created `aws-waf-logs-` log group, keeping the requests WAF does
   * not allow ({@link DEFAULT_LOGGING_FILTER}) and redacting
   * {@link DEFAULT_LOGGING_REDACTED_HEADERS}.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  logging: {},
} as const;

/**
 * Visibility settings that are not configurable. CloudWatch metrics are always
 * on for the web ACL and every rule: they are free, and the recommended alarms
 * and `metrics` helper read them.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-metrics.html
 */
export const WEB_ACL_VISIBILITY_DEFAULTS = {
  cloudWatchMetricsEnabled: true,
} as const;

/**
 * Gap between the priorities of consecutive rules, so a rule can be inserted
 * with an explicit `.priority(n)` without renumbering the others.
 */
export const DEFAULT_RULE_PRIORITY_STEP = 10;

/**
 * The prefix AWS WAF requires of a CloudWatch log group, S3 bucket or Firehose
 * stream it logs to.
 *
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/logging-cw-logs.html
 */
export const WAF_LOG_GROUP_NAME_PREFIX = "aws-waf-logs-";

/**
 * Headers always redacted from WAF logs. Both carry credentials a log reader
 * could replay, and neither helps tune a rule.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_data_classification_define_protection.html
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/logging-management.html
 */
export const DEFAULT_LOGGING_REDACTED_HEADERS: readonly string[] = ["authorization", "cookie"];

/**
 * Logs every request WAF does not simply allow, and drops the rest. Filtering
 * is AWS's main lever on log volume and cost, and the allowed requests are
 * rarely what a rule is tuned against.
 *
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/logging-management.html
 * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
 */
export const DEFAULT_LOGGING_FILTER = {
  defaultBehavior: "DROP",
  filters: [
    {
      behavior: "KEEP",
      requirement: "MEETS_ANY",
      conditions: [
        { action: "BLOCK" },
        { action: "COUNT" },
        { action: "CAPTCHA" },
        { action: "CHALLENGE" },
        { action: "EXCLUDED_AS_COUNT" },
      ],
    },
  ],
} as const satisfies WebAclLoggingFilter;
