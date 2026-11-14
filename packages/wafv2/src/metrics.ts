import { Duration, Fn, Stack, Token } from "aws-cdk-lib";
import { Metric, type MetricOptions, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

/**
 * The request-count metrics WAF publishes for a web ACL, a rule, or the
 * default action. Each is a Sum over 5 minutes unless `options` say
 * otherwise. WAF publishes a datapoint only when the count is non-zero.
 *
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-metrics.html
 */
export interface WebAclRequestMetrics {
  allowedRequests(options?: MetricOptions): Metric;
  blockedRequests(options?: MetricOptions): Metric;
  countedRequests(options?: MetricOptions): Metric;
  captchaRequests(options?: MetricOptions): Metric;
  challengeRequests(options?: MetricOptions): Metric;
}

/**
 * The metrics of a web ACL, with dimensions built from the names the builder
 * gave it and its rules, so they match what WAF publishes. The top-level
 * metrics cover every rule (`Rule=ALL`).
 */
export interface WebAclMetrics extends WebAclRequestMetrics {
  /** Requests no rule terminated, which the default action decided. */
  readonly defaultAction: WebAclRequestMetrics;

  /**
   * The metrics of one rule, by the name given to `addRule`.
   *
   * @throws when the web ACL has no rule of that name.
   */
  rule(name: string): WebAclRequestMetrics;

  /**
   * Days until a pinned managed rule group version expires. Published only
   * for a group the web ACL uses at that version.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-using-managed-rule-groups-expiration.html
   */
  daysToExpiry(group: ManagedRuleGroupVersion, options?: MetricOptions): Metric;
}

/** A managed rule group at a pinned version. */
export interface ManagedRuleGroupVersion {
  readonly vendorName: string;
  readonly name: string;
  readonly version: string;
}

const NAMESPACE = "AWS/WAFV2";
/** @internal — the period of every request metric unless overridden. */
export const REQUEST_METRIC_PERIOD = Duration.minutes(5);
const ALL_RULES = "ALL";

/**
 * The value of a web ACL's `WebACL` dimension: its name. WAF publishes the
 * name here, not the `VisibilityConfig` metric name the documentation
 * describes. A web ACL without a literal name reads it from `Ref`, which is
 * `name|id|scope`.
 */
function webAclDimension(webAcl: CfnWebACL): string {
  const { name } = webAcl;
  if (name !== undefined && !Token.isUnresolved(name)) return name;
  return Fn.select(0, Fn.split("|", webAcl.ref));
}

/**
 * Builds a web ACL's {@link WebAclMetrics}.
 *
 * @param metricName - The web ACL's own metric name, which WAF publishes the
 *   default action's metrics under as the `Rule` dimension.
 * @param ruleMetricNames - Each rule's metric name, by rule name.
 *
 * @internal
 */
export function webAclMetrics(
  webAcl: CfnWebACL,
  metricName: string,
  ruleMetricNames: ReadonlyMap<string, string>,
): WebAclMetrics {
  // CloudFront metrics have no `Region` dimension.
  const regionDimension: Record<string, string> =
    webAcl.scope === "CLOUDFRONT" ? {} : { Region: Stack.of(webAcl).region };
  const webAclName = webAclDimension(webAcl);

  const metric = (name: string, dimensionsMap: Record<string, string>, options?: MetricOptions) =>
    new Metric({
      namespace: NAMESPACE,
      metricName: name,
      statistic: Stats.SUM,
      period: REQUEST_METRIC_PERIOD,
      ...options,
      dimensionsMap: { ...dimensionsMap, ...regionDimension, ...options?.dimensionsMap },
    });

  const requests = (rule: string): WebAclRequestMetrics => {
    const dimensions = { WebACL: webAclName, Rule: rule };
    return {
      allowedRequests: (o) => metric("AllowedRequests", dimensions, o),
      blockedRequests: (o) => metric("BlockedRequests", dimensions, o),
      countedRequests: (o) => metric("CountedRequests", dimensions, o),
      captchaRequests: (o) => metric("CaptchaRequests", dimensions, o),
      challengeRequests: (o) => metric("ChallengeRequests", dimensions, o),
    };
  };

  return {
    ...requests(ALL_RULES),
    defaultAction: requests(metricName),
    rule: (name) => {
      const ruleMetricName = ruleMetricNames.get(name);
      if (ruleMetricName === undefined) {
        throw new Error(
          `The web ACL has no rule named "${name}". Rules: ${[...ruleMetricNames.keys()].join(", ") || "none"}.`,
        );
      }
      return requests(ruleMetricName);
    },
    daysToExpiry: (group, options) =>
      metric(
        "DaysToExpiry",
        { Vendor: group.vendorName, ManagedRuleGroup: group.name, Version: group.version },
        { statistic: Stats.MINIMUM, period: Duration.hours(1), ...options },
      ),
  };
}
