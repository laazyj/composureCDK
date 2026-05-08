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
import type { HealthCheckBuilderProps } from "./health-check-builder.js";

/**
 * Naming prefix applied to every auto-created Route 53 query-log group. A
 * single shared resource policy targets `<prefix>/*` so multiple hosted zones
 * in the same stack share one `AWS::Logs::ResourcePolicy` (the per-region
 * soft limit is 10). Matches the prefix the Route 53 console uses.
 *
 * @see https://docs.aws.amazon.com/Route53/latest/APIReference/API_CreateQueryLoggingConfig.html
 */
export const QUERY_LOGGING_LOG_GROUP_NAME_PREFIX = "/aws/route53";

/**
 * Construct id of the shared `AWS::Logs::ResourcePolicy` materialised once
 * per stack when any hosted zone in that stack uses auto-managed query
 * logging. Package-internal — used by the dedup helper and the unit tests, and
 * intentionally not re-exported from the package barrel; consumers should not
 * reference the policy directly.
 */
export const QUERY_LOGGING_RESOURCE_POLICY_ID = "ComposureCDKRoute53QueryLoggingPolicy";

/**
 * Stable resource-policy name written into CloudWatch Logs so the policy is
 * deduplicated when the same stack is re-synthesised across deployments.
 */
export const QUERY_LOGGING_RESOURCE_POLICY_NAME = "ComposureCDK-Route53QueryLogging";

/**
 * Secure, AWS-recommended defaults applied to every public hosted zone built
 * with {@link createHostedZoneBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * Query logging is enabled by default: the builder auto-creates a CloudWatch
 * {@link import("aws-cdk-lib/aws-logs").LogGroup} under
 * `${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/<zoneName>` and a single shared
 * `AWS::Logs::ResourcePolicy` granting `route53.amazonaws.com` permission to
 * write log streams. Disable with `.queryLogging(false)` or supply a managed
 * log group via `.queryLogging({ logGroupArn })`.
 *
 * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/query-logs.html
 */
export const HOSTED_ZONE_DEFAULTS: Partial<HostedZoneBuilderProps> = {
  /**
   * Add a trailing dot to the zone name so the apex is an unambiguous
   * fully-qualified domain. Matches the CDK default and RFC 1035.
   */
  addTrailingDot: true,
  /**
   * Enable DNS query logging out of the box, with the auto-managed log
   * group and shared resource policy described above. Set to `false` or to
   * `{ logGroupArn: '...' }` to deviate.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  queryLogging: {},
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

/**
 * Defaults for {@link createHealthCheckBuilder}. Overridable via the fluent API.
 *
 * `failureThreshold` and `requestInterval` match CDK's defaults but are set
 * explicitly so the values are surfaced in the package's defaults table and
 * can be reasoned about without consulting CDK source. `measureLatency` is
 * defaulted ON to align with the AWS Well-Architected operational-excellence
 * pillar (per-region latency visibility on the Route 53 Health Checks
 * console). It carries a small additional cost — disable explicitly via
 * `.measureLatency(false)` if cost is a concern.
 *
 * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html
 */
export const HEALTH_CHECK_DEFAULTS: Partial<HealthCheckBuilderProps> = {
  failureThreshold: 3,
  requestInterval: Duration.seconds(30),
  measureLatency: true,
};
