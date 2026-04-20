import { Duration } from "aws-cdk-lib";
import type { HostedZoneBuilderProps } from "./hosted-zone-builder.js";
import type { ARecordBuilderProps } from "./a-record-builder.js";
import type { AaaaRecordBuilderProps } from "./aaaa-record-builder.js";
import type { CnameRecordBuilderProps } from "./cname-record-builder.js";
import type { TxtRecordBuilderProps } from "./txt-record-builder.js";
import type { MxRecordBuilderProps } from "./mx-record-builder.js";
import type { SrvRecordBuilderProps } from "./srv-record-builder.js";
import type { CaaRecordBuilderProps } from "./caa-record-builder.js";
import type { NsRecordBuilderProps } from "./ns-record-builder.js";
import type { DsRecordBuilderProps } from "./ds-record-builder.js";
import type { HttpsRecordBuilderProps } from "./https-record-builder.js";
import type { SvcbRecordBuilderProps } from "./svcb-record-builder.js";

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

/**
 * Defaults for {@link createMxRecordBuilder}. Overridable via the fluent API.
 */
export const MX_RECORD_DEFAULTS: Partial<MxRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};

/**
 * Defaults for {@link createSrvRecordBuilder}. Overridable via the fluent API.
 */
export const SRV_RECORD_DEFAULTS: Partial<SrvRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};

/**
 * Defaults for {@link createCaaRecordBuilder}. Overridable via the fluent API.
 */
export const CAA_RECORD_DEFAULTS: Partial<CaaRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};

/**
 * Defaults for {@link createNsRecordBuilder}. Overridable via the fluent API.
 *
 * A longer TTL is appropriate for delegation records — resolvers cache NS
 * responses, and frequent churn forces parent-side re-delegation lookups.
 */
export const NS_RECORD_DEFAULTS: Partial<NsRecordBuilderProps> = {
  ttl: Duration.hours(24),
};

/**
 * Defaults for {@link createDsRecordBuilder}. Overridable via the fluent API.
 *
 * DS records change rarely (key-signing rollovers); a long TTL reduces
 * DNSSEC validation load on resolvers.
 */
export const DS_RECORD_DEFAULTS: Partial<DsRecordBuilderProps> = {
  ttl: Duration.hours(24),
};

/**
 * Defaults for {@link createHttpsRecordBuilder}. Overridable via the fluent API.
 * Same alias-target caveat as {@link A_RECORD_DEFAULTS}.
 */
export const HTTPS_RECORD_DEFAULTS: Partial<HttpsRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};

/**
 * Defaults for {@link createSvcbRecordBuilder}. Overridable via the fluent API.
 */
export const SVCB_RECORD_DEFAULTS: Partial<SvcbRecordBuilderProps> = {
  ttl: DEFAULT_RECORD_TTL,
};
