import { type Duration, Token } from "aws-cdk-lib";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

/**
 * One key a rate-based rule aggregates requests on, as CloudFormation's
 * `RateBasedStatementCustomKey`: exactly one of `header`, `cookie`,
 * `queryArgument`, `queryString`, `uriPath`, `httpMethod`, `labelNamespace`,
 * `ip`, `forwardedIp` and the rest. The `any`-typed ones (`ip`, `forwardedIp`,
 * `httpMethod`, `asn`) take an empty object.
 */
export type RateLimitAggregateKey = CfnWebACL.RateBasedStatementCustomKeyProperty;

/**
 * What WAF does with a request whose forwarded-IP header is missing or not a
 * valid IP address: `MATCH` treats it as matching the rule, `NO_MATCH` as not.
 */
export type ForwardedIpFallback = "MATCH" | "NO_MATCH";

/** @internal — what the rule builder collects for a rate-based rule. */
export interface RateLimitSpec {
  readonly limit: number;
  readonly window: Duration;
}

/** @internal — the aggregation the rule builder collects for a rate-based rule. */
export interface RateLimitAggregation {
  readonly keys: readonly RateLimitAggregateKey[];
  readonly forwardedIpConfig?: CfnWebACL.ForwardedIPConfigurationProperty;
}

const SOURCE = "https://docs.aws.amazon.com/waf/latest/APIReference/API_RateBasedStatement.html";
const KEY_SOURCE =
  "https://docs.aws.amazon.com/waf/latest/APIReference/API_RateBasedStatementCustomKey.html";

const MIN_LIMIT = 10;
const MAX_LIMIT = 2_000_000_000;
/** The evaluation windows WAF accepts, in seconds. */
const WINDOWS = [60, 120, 300, 600];
const MAX_KEYS = 5;

/** Keys that identify their instance by a name, so may appear once per name. */
const NAMED_KEYS = {
  header: "name",
  cookie: "name",
  queryArgument: "name",
  labelNamespace: "namespace",
} as const;

/**
 * A key's identity for the duplicate check: its type, plus its name for the
 * types that can repeat with different names. Header and cookie names are
 * matched case-insensitively, as WAF matches them.
 */
function keyIdentity(owner: string, key: RateLimitAggregateKey): string | undefined {
  const types = Object.entries(key).filter(([, value]) => value !== undefined);
  if (types.length !== 1) {
    throw new Error(
      `${owner}: each rate-limit aggregate key sets exactly one key type, but one sets ` +
        `${types.length === 0 ? "none" : types.map(([type]) => type).join(", ")}. See ${KEY_SOURCE}.`,
    );
  }
  const [type, value] = types[0] as [string, unknown];
  if (!(type in NAMED_KEYS) || Token.isUnresolved(value)) return type;
  const field = NAMED_KEYS[type as keyof typeof NAMED_KEYS];
  const name = (value as Record<string, unknown>)[field];
  if (typeof name !== "string" || Token.isUnresolved(name)) return undefined;
  return `${type} "${type === "labelNamespace" ? name : name.toLowerCase()}"`;
}

function validateKeys(owner: string, aggregation: RateLimitAggregation): void {
  const { keys } = aggregation;
  if (keys.length > MAX_KEYS) {
    throw new Error(
      `${owner}: a rate-based rule aggregates on at most ${String(MAX_KEYS)} keys, but ${String(keys.length)} were given. See ${SOURCE}.`,
    );
  }
  const seen = new Set<string>();
  for (const key of keys) {
    const identity = keyIdentity(owner, key);
    if (identity === undefined) continue;
    if (seen.has(identity)) {
      throw new Error(
        `${owner}: the rate-based rule aggregates on ${identity} twice. Each key must be distinct. See ${KEY_SOURCE}.`,
      );
    }
    seen.add(identity);
  }
  const forwarded = keys.some((k) => k.forwardedIp !== undefined);
  if (forwarded && aggregation.forwardedIpConfig === undefined) {
    throw new Error(
      `${owner}: the rate-based rule aggregates on a forwarded IP without saying which header ` +
        `carries it. Use .aggregateOnForwardedIp(header, fallback) instead of a raw forwardedIp key.`,
    );
  }
}

function validateLimit(owner: string, limit: number): void {
  if (Token.isUnresolved(limit)) return;
  if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    throw new Error(
      `${owner}: a rate limit must be a whole number from ${String(MIN_LIMIT)} to ` +
        `${MAX_LIMIT.toLocaleString("en-US")}, but was ${String(limit)}. See ${SOURCE}.`,
    );
  }
}

function windowSeconds(owner: string, window: Duration): number {
  const seconds = window.toSeconds();
  if (!Token.isUnresolved(seconds) && !WINDOWS.includes(seconds)) {
    throw new Error(
      `${owner}: a rate limit's window must be 1, 2, 5 or 10 minutes, but was ${window.toHumanString()}. See ${SOURCE}.`,
    );
  }
  return seconds;
}

/**
 * Turns a rate limit and its aggregation into a `RateBasedStatement`. No keys
 * aggregates on the client IP. A single IP or forwarded-IP key uses WAF's
 * `IP` or `FORWARDED_IP` aggregate key type, since WAF only accepts those
 * keys among custom keys alongside another; anything else is `CUSTOM_KEYS`.
 *
 * @internal
 */
export function rateBasedStatement(
  owner: string,
  rate: RateLimitSpec,
  aggregation: RateLimitAggregation,
  scopeDownStatement: CfnWebACL.StatementProperty | undefined,
): CfnWebACL.RateBasedStatementProperty {
  validateLimit(owner, rate.limit);
  const evaluationWindowSec = windowSeconds(owner, rate.window);
  validateKeys(owner, aggregation);

  const { keys, forwardedIpConfig } = aggregation;
  const only = keys.length === 1 ? keys[0] : undefined;
  const aggregateKeyType =
    keys.length === 0 || only?.ip !== undefined
      ? "IP"
      : only?.forwardedIp !== undefined
        ? "FORWARDED_IP"
        : "CUSTOM_KEYS";

  return {
    limit: rate.limit,
    evaluationWindowSec,
    aggregateKeyType,
    ...(aggregateKeyType === "CUSTOM_KEYS" && { customKeys: [...keys] }),
    ...(forwardedIpConfig && { forwardedIpConfig }),
    ...(scopeDownStatement && { scopeDownStatement }),
  };
}

/**
 * A key's text transformations when it is matched as sent.
 *
 * @internal
 */
export const NO_TRANSFORMATION: readonly CfnWebACL.TextTransformationProperty[] = Object.freeze([
  Object.freeze({ priority: 0, type: "NONE" }),
]);
