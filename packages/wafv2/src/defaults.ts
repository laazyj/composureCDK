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
