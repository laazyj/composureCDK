import type { Duration } from "aws-cdk-lib";
import { CaaTag, type HttpsRecordValue, type SvcbRecordValue } from "aws-cdk-lib/aws-route53";

/**
 * Sentinel name representing the zone apex (the zone-file `@`).
 *
 * Translated to an undefined CDK `recordName` when bound to a CDK construct.
 */
export const APEX = "@";

/**
 * Per-record options applied to the underlying CDK construct.
 *
 * Mirrors the optional fields shared by every Route 53 record builder. Each
 * record-type DSL helper accepts these as a trailing options argument.
 */
export interface RecordOptions {
  /** TTL for the record set. Falls back to the underlying builder's default. */
  readonly ttl?: Duration;
  /** Optional comment passed through to the CDK construct. */
  readonly comment?: string;
}

export interface ARecordSpec extends RecordOptions {
  readonly type: "A";
  readonly name: string;
  readonly addresses: readonly string[];
}

export interface AaaaRecordSpec extends RecordOptions {
  readonly type: "AAAA";
  readonly name: string;
  readonly addresses: readonly string[];
}

export interface CnameRecordSpec extends RecordOptions {
  readonly type: "CNAME";
  readonly name: string;
  readonly target: string;
}

export interface TxtRecordSpec extends RecordOptions {
  readonly type: "TXT";
  readonly name: string;
  readonly values: readonly string[];
}

export interface MxRecordSpec extends RecordOptions {
  readonly type: "MX";
  readonly name: string;
  readonly values: readonly { readonly priority: number; readonly hostName: string }[];
}

export interface SrvRecordSpec extends RecordOptions {
  readonly type: "SRV";
  readonly name: string;
  readonly values: readonly {
    readonly priority: number;
    readonly weight: number;
    readonly port: number;
    readonly hostName: string;
  }[];
}

export interface CaaRecordSpec extends RecordOptions {
  readonly type: "CAA";
  readonly name: string;
  readonly values: readonly {
    readonly flag: number;
    readonly tag: CaaTag;
    readonly value: string;
  }[];
}

export interface NsRecordSpec extends RecordOptions {
  readonly type: "NS";
  readonly name: string;
  readonly values: readonly string[];
}

export interface DsRecordSpec extends RecordOptions {
  readonly type: "DS";
  readonly name: string;
  readonly values: readonly string[];
}

export interface HttpsRecordSpec extends RecordOptions {
  readonly type: "HTTPS";
  readonly name: string;
  readonly values: readonly HttpsRecordValue[];
}

export interface SvcbRecordSpec extends RecordOptions {
  readonly type: "SVCB";
  readonly name: string;
  readonly values: readonly SvcbRecordValue[];
}

export type RecordSpec =
  | ARecordSpec
  | AaaaRecordSpec
  | CnameRecordSpec
  | TxtRecordSpec
  | MxRecordSpec
  | SrvRecordSpec
  | CaaRecordSpec
  | NsRecordSpec
  | DsRecordSpec
  | HttpsRecordSpec
  | SvcbRecordSpec;

/** Record type discriminators surfaced by {@link RecordSpec}. */
export type RecordType = RecordSpec["type"];

const toArray = <T>(x: T | readonly T[]): readonly T[] =>
  Array.isArray(x) ? (x as readonly T[]) : [x as T];

/**
 * IPv4 address record. Use {@link APEX} (`"@"`) as `name` for the zone apex.
 *
 * Multiple `A` calls for the same `name` are merged into a single CDK record
 * set with all addresses; alternatively, pass an array as the second argument.
 *
 * @example
 * ```ts
 * A("@",  "1.2.3.4")
 * A("ha", ["1.2.3.4", "5.6.7.8"])
 * A("www", "1.2.3.4", { ttl: Duration.minutes(10) })
 * ```
 */
export function A(
  name: string,
  address: string | readonly string[],
  options: RecordOptions = {},
): ARecordSpec {
  return { type: "A", name, addresses: toArray(address), ...options };
}

/**
 * IPv6 address record. See {@link A} for the merging / array semantics — they
 * are identical.
 */
export function AAAA(
  name: string,
  address: string | readonly string[],
  options: RecordOptions = {},
): AaaaRecordSpec {
  return { type: "AAAA", name, addresses: toArray(address), ...options };
}

/**
 * Canonical-name record. DNS forbids more than one CNAME per name, so a second
 * `CNAME(name, …)` for the same name is a configuration error and is rejected
 * when the records are bound to the zone.
 *
 * CNAMEs also cannot live at the zone apex — use an A/AAAA alias instead.
 *
 * Targets containing dots should be fully qualified (trailing `.`).
 *
 * @example
 * ```ts
 * CNAME("dkim1", "dkim1.39769.dkim.example.")
 * ```
 */
export function CNAME(name: string, target: string, options: RecordOptions = {}): CnameRecordSpec {
  return { type: "CNAME", name, target, ...options };
}

/**
 * Text record. Pass a single string or an array of strings; multiple `TXT`
 * calls for the same `name` are merged into one CDK record set.
 *
 * @example
 * ```ts
 * TXT("@",      "v=spf1 mx -all")
 * TXT("_dmarc", "v=DMARC1; p=none;")
 * TXT("multi",  ["one", "two"])
 * ```
 */
export function TXT(
  name: string,
  value: string | readonly string[],
  options: RecordOptions = {},
): TxtRecordSpec {
  return { type: "TXT", name, values: toArray(value), ...options };
}

/**
 * Mail-exchanger record. The argument order matches BIND zone files
 * (`name priority target`); multiple `MX(name, …)` calls for the same name are
 * merged into one CDK record set with all `(priority, hostName)` pairs.
 *
 * Targets containing dots should be fully qualified (trailing `.`).
 *
 * @example
 * ```ts
 * MX("@", 10, "mail.example.com.")
 * MX("@", 20, "backup.example.com.")
 * ```
 */
export function MX(
  name: string,
  priority: number,
  hostName: string,
  options: RecordOptions = {},
): MxRecordSpec {
  return { type: "MX", name, values: [{ priority, hostName }], ...options };
}

/**
 * Service-locator record. The argument order matches BIND zone files
 * (`name priority weight port target`); multiple `SRV(name, …)` calls for the
 * same name are merged into one CDK record set.
 *
 * Record names typically follow the `_service._proto` convention (e.g.
 * `_sip._tcp`). Lower priority wins; weight distributes load across peers.
 *
 * @example
 * ```ts
 * SRV("_sip._tcp", 10, 60, 5060, "sip1.example.com.")
 * SRV("_sip._tcp", 10, 40, 5060, "sip2.example.com.")
 * ```
 */
export function SRV(
  name: string,
  priority: number,
  weight: number,
  port: number,
  hostName: string,
  options: RecordOptions = {},
): SrvRecordSpec {
  return { type: "SRV", name, values: [{ priority, weight, port, hostName }], ...options };
}

/**
 * Certification-authority authorization record. Argument order matches BIND
 * zone files (`name flag tag value`); multiple `CAA(name, …)` calls for the
 * same name are merged into one CDK record set.
 *
 * For the common cases, prefer {@link CAA_ISSUE}, {@link CAA_ISSUEWILD}, or
 * {@link CAA_IODEF}.
 *
 * @example
 * ```ts
 * CAA("@", 0, CaaTag.ISSUE, "amazon.com")
 * ```
 */
export function CAA(
  name: string,
  flag: number,
  tag: CaaTag,
  value: string,
  options: RecordOptions = {},
): CaaRecordSpec {
  return { type: "CAA", name, values: [{ flag, tag, value }], ...options };
}

/**
 * CAA `issue` record — authorizes a specific certificate authority to issue
 * certificates for the name. Merges with other CAA records at the same name.
 *
 * @example
 * ```ts
 * CAA_ISSUE("@", "amazon.com")
 * CAA_ISSUE("@", "amazontrust.com")
 * ```
 */
export function CAA_ISSUE(name: string, authority: string, options: RecordOptions = {}) {
  return CAA(name, 0, CaaTag.ISSUE, authority, options);
}

/**
 * CAA `issuewild` record — authorizes a specific CA to issue wildcard
 * certificates for the name. Merges with other CAA records at the same name.
 */
export function CAA_ISSUEWILD(name: string, authority: string, options: RecordOptions = {}) {
  return CAA(name, 0, CaaTag.ISSUEWILD, authority, options);
}

/**
 * CAA `iodef` record — reports policy violations to a URL. Merges with other
 * CAA records at the same name.
 *
 * @example
 * ```ts
 * CAA_IODEF("@", "mailto:security@example.com")
 * ```
 */
export function CAA_IODEF(name: string, url: string, options: RecordOptions = {}) {
  return CAA(name, 0, CaaTag.IODEF, url, options);
}

/**
 * Name-server delegation record. Delegates a subdomain to the supplied name
 * servers. NS records cannot live at the zone apex — the apex NS set is
 * managed by Route 53 itself.
 *
 * Multiple `NS(name, …)` calls for the same name are merged; alternatively,
 * pass an array of host names.
 *
 * @example
 * ```ts
 * NS("internal", ["ns-1.awsdns-00.co.uk.", "ns-2.awsdns-00.com."])
 * ```
 */
export function NS(
  name: string,
  hostName: string | readonly string[],
  options: RecordOptions = {},
): NsRecordSpec {
  return { type: "NS", name, values: toArray(hostName), ...options };
}

/**
 * DNSSEC delegation-signer record. Each value is a full rdata string
 * (`keyTag algorithm digestType digest`). Multiple `DS(name, …)` calls for the
 * same name are merged.
 *
 * @example
 * ```ts
 * DS("secure", "60485 5 1 2BB183AF5F22588179A53B0A98631FAD1A292118")
 * ```
 */
export function DS(
  name: string,
  rdata: string | readonly string[],
  options: RecordOptions = {},
): DsRecordSpec {
  return { type: "DS", name, values: toArray(rdata), ...options };
}

/**
 * HTTPS service-binding record (RFC 9460). Accepts pre-constructed
 * {@link HttpsRecordValue} instances from the CDK. For alias-mode HTTPS
 * records (typically pointing at a CloudFront distribution), use
 * `createHttpsRecordBuilder` directly — the DSL supports value-mode only.
 *
 * Multiple `HTTPS(name, …)` calls for the same name are merged.
 *
 * @example
 * ```ts
 * HTTPS("@", HttpsRecordValue.service({ alpn: [Alpn.H3, Alpn.H2] }))
 * ```
 */
export function HTTPS(
  name: string,
  value: HttpsRecordValue | readonly HttpsRecordValue[],
  options: RecordOptions = {},
): HttpsRecordSpec {
  return { type: "HTTPS", name, values: toArray(value), ...options };
}

/**
 * Generic service-binding record (RFC 9460). For HTTPS specifically, prefer
 * {@link HTTPS} — most clients only consult HTTPS records for web traffic.
 *
 * Multiple `SVCB(name, …)` calls for the same name are merged.
 */
export function SVCB(
  name: string,
  value: SvcbRecordValue | readonly SvcbRecordValue[],
  options: RecordOptions = {},
): SvcbRecordSpec {
  return { type: "SVCB", name, values: toArray(value), ...options };
}
