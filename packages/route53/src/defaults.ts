import { Duration } from "aws-cdk-lib";
import type { HostedZoneBuilderProps } from "./hosted-zone-builder.js";
import type { ARecordBuilderProps } from "./a-record-builder.js";
import type { AaaaRecordBuilderProps } from "./aaaa-record-builder.js";
import type { CnameRecordBuilderProps } from "./cname-record-builder.js";
import type { TxtRecordBuilderProps } from "./txt-record-builder.js";

/**
 * Secure, AWS-recommended defaults applied to every public hosted zone built
 * with {@link createHostedZoneBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * Query logging is not enabled by default: Route53 query logs must be written
 * to a CloudWatch log group in `us-east-1` with a resource policy granting
 * `route53.amazonaws.com` write access. Opt in explicitly by calling
 * `.queryLogsLogGroupArn(...)` with a pre-configured log group.
 */
export const HOSTED_ZONE_DEFAULTS: Partial<HostedZoneBuilderProps> = {
  /**
   * Add a trailing dot to the zone name so the apex is an unambiguous
   * fully-qualified domain. Matches the CDK default and RFC 1035.
   */
  addTrailingDot: true,
};

/**
 * Default TTL applied to records built by this package when no TTL is set.
 *
 * Five minutes balances propagation latency against downstream DNS cache
 * churn. For alias records pointing at dynamic AWS resources (CloudFront,
 * ALB), this matches AWS guidance.
 *
 * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
 */
const DEFAULT_RECORD_TTL = Duration.minutes(5);

/**
 * Defaults for {@link createARecordBuilder}. Overridable via the fluent API.
 * The builder skips the `ttl` default for alias targets — AWS ignores TTL on
 * alias records and CDK emits a warning when one is set.
 */
export const A_RECORD_DEFAULTS: Partial<ARecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};

/**
 * Defaults for {@link createAaaaRecordBuilder}. Overridable via the fluent API.
 * Same alias-target caveat as {@link A_RECORD_DEFAULTS}.
 */
export const AAAA_RECORD_DEFAULTS: Partial<AaaaRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};

/**
 * Defaults for {@link createCnameRecordBuilder}. Overridable via the fluent API.
 */
export const CNAME_RECORD_DEFAULTS: Partial<CnameRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};

/**
 * Defaults for {@link createTxtRecordBuilder}. Overridable via the fluent API.
 */
export const TXT_RECORD_DEFAULTS: Partial<TxtRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};
