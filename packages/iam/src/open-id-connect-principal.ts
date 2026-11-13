import { OpenIdConnectPrincipal } from "aws-cdk-lib/aws-iam";

type ConditionOperatorBase =
  | "StringEquals"
  | "StringNotEquals"
  | "StringEqualsIgnoreCase"
  | "StringNotEqualsIgnoreCase"
  | "StringLike"
  | "StringNotLike"
  | "NumericEquals"
  | "NumericNotEquals"
  | "NumericLessThan"
  | "NumericLessThanEquals"
  | "NumericGreaterThan"
  | "NumericGreaterThanEquals"
  | "DateEquals"
  | "DateNotEquals"
  | "DateLessThan"
  | "DateLessThanEquals"
  | "DateGreaterThan"
  | "DateGreaterThanEquals"
  | "Bool"
  | "BinaryEquals"
  | "IpAddress"
  | "NotIpAddress"
  | "ArnEquals"
  | "ArnNotEquals"
  | "ArnLike"
  | "ArnNotLike";

/**
 * An IAM condition operator, optionally with a `ForAnyValue:`/`ForAllValues:`
 * set qualifier and an `IfExists` suffix. `Null` takes neither.
 *
 * A closed union rather than `string`, so a typo such as `StringLikee` fails
 * to compile instead of producing a condition IAM rejects at deploy time.
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html
 */
export type ConditionOperator =
  `${"" | "ForAnyValue:" | "ForAllValues:"}${ConditionOperatorBase}${"" | "IfExists"}` | "Null";

/** Brands an {@link OidcClaimReference}; `Symbol.for` so the ESM and CJS copies agree. */
const CLAIM_REFERENCE = Symbol.for("@composurecdk/iam.OidcClaimReference");

/**
 * A reference to a claim of the federated token, for use as a condition
 * value. Create one with {@link oidcClaim}; {@link openIdConnectPrincipal}
 * renders it as the policy variable `${issuerHost:claim}`.
 */
export interface OidcClaimReference {
  /** The claim, bare (`"sub"`) or already qualified (`"oidc.example.com:sub"`). */
  readonly claim: string;
}

/**
 * References a claim of the federated token as a condition value, so the
 * issuer host in the policy variable is written by
 * {@link openIdConnectPrincipal} rather than by hand. The claim is qualified
 * by the same rule as condition keys: a bare claim gets the issuer host, and
 * one that contains `:` passes through.
 *
 * @throws Error if `claim` is empty or contains `$`, `{` or `}`.
 *
 * @example
 * ```ts
 * // Pins the session name to the caller's subject:
 * // "sts:RoleSessionName": "${oidc.example.com:sub}"
 * conditions: { StringEquals: { "sts:RoleSessionName": oidcClaim("sub") } }
 * ```
 */
export function oidcClaim(claim: string): OidcClaimReference {
  if (!claim || /[${}]/.test(claim)) {
    throw new Error(
      `oidcClaim: claim must be a non-empty name without "$", "{" or "}" (got "${claim}").`,
    );
  }
  return Object.defineProperty({ claim }, CLAIM_REFERENCE, { value: true });
}

function isClaimReference(value: unknown): value is OidcClaimReference {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[CLAIM_REFERENCE] === true
  );
}

/** A single condition value: a literal string, or a reference to a token claim. */
type ConditionValue = string | OidcClaimReference;

/** Condition values keyed by bare claim name or fully-qualified condition key. */
type ClaimConditions = Record<string, ConditionValue | ConditionValue[]>;

/** The rendered form: what IAM receives. */
type RenderedConditions = Record<string, string | string[]>;

/** Qualifies a bare claim with the issuer host; a name containing `:` passes through. */
function qualify(issuerHost: string, name: string): string {
  return name.includes(":") ? name : `${issuerHost}:${name}`;
}

function render(issuerHost: string, value: ConditionValue): string {
  if (typeof value === "string") return value;
  if (isClaimReference(value)) return `\${${qualify(issuerHost, value.claim)}}`;
  throw new Error(
    "openIdConnectPrincipal: a condition value must be a string or come from oidcClaim(...).",
  );
}

/**
 * IAM matches a condition key against any of its values, so `"x"` and `["x"]`,
 * or `["a", "b"]` and `["b", "a"]`, are the same condition. Compare by value set.
 */
function sameValues(a: string | string[], b: string | string[]): boolean {
  const normalise = (v: string | string[]) => JSON.stringify([...new Set([v].flat())].sort());
  return normalise(a) === normalise(b);
}

/**
 * Options for {@link openIdConnectPrincipal}.
 *
 * Claim keys are supplied bare (e.g. `"aud"`, `"sub"`); the helper prefixes
 * each with `${issuerHost}:` to form the fully-qualified trust-policy condition
 * key (e.g. `token.actions.githubusercontent.com:sub`). This removes the
 * error-prone, security-critical step of hand-writing the issuer prefix, for
 * every operator.
 *
 * A key that already contains `:` is treated as fully qualified and passed
 * through unchanged — global and STS keys such as `sts:RoleSessionName` or
 * `aws:RequestTag/team`, and claim keys that already carry the issuer host.
 * Prefixing those would yield a key no request ever carries, so the condition
 * would silently never match.
 */
export interface OpenIdConnectPrincipalOptions {
  /**
   * The OIDC provider the role federates with: whatever CDK's own
   * `OpenIdConnectPrincipal` accepts, so on current `aws-cdk-lib` both
   * `OpenIdConnectProvider` and `OidcProviderNative` (and their imports) work.
   */
  readonly provider: ConstructorParameters<typeof OpenIdConnectPrincipal>[0];

  /**
   * The provider's issuer host, used to prefix every condition key — the
   * host portion of the issuer URL, without scheme
   * (e.g. `"token.actions.githubusercontent.com"`).
   */
  readonly issuerHost: string;

  /** Exact-match (`StringEquals`) conditions. Shorthand for `conditions.StringEquals`. */
  readonly stringEquals?: ClaimConditions;

  /** Pattern-match (`StringLike`) conditions. Shorthand for `conditions.StringLike`. */
  readonly stringLike?: ClaimConditions;

  /**
   * Conditions for any operator, keyed by operator — e.g. `ForAnyValue:StringLike`
   * for a multi-valued claim such as `amr`, or `StringNotLike` for an exclusion.
   * Keys are qualified by the same rule as `stringEquals`/`stringLike`.
   *
   * An operator given here as well as through its shorthand is merged. The same
   * condition key given twice under one operator with different values throws,
   * rather than letting one silently win. Values are compared as IAM reads
   * them — as a set — so `"x"` and `["x"]` do not conflict.
   *
   * A value may reference a token claim with {@link oidcClaim}, which renders
   * the policy variable `${issuerHost:claim}` without hand-typing the host.
   */
  readonly conditions?: Partial<Record<ConditionOperator, ClaimConditions>>;
}

/**
 * Builds an {@link OpenIdConnectPrincipal} for a web-identity (OIDC) trust
 * policy, prefixing every bare claim key with `${issuerHost}:`.
 *
 * Provider-agnostic: use it directly for any OIDC IdP, or reach for the
 * {@link githubActions} helpers which layer the GitHub constants on top. The
 * returned principal is passed to `createRoleBuilder().assumedBy(...)`.
 *
 * @throws Error if one condition key, once qualified, is given two different
 * sets of values under the same operator.
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html
 *
 * @example
 * ```ts
 * const principal = openIdConnectPrincipal({
 *   provider,
 *   issuerHost: "token.actions.githubusercontent.com",
 *   stringEquals: { aud: "sts.amazonaws.com" },
 *   stringLike: { sub: ["repo:acme/app:ref:refs/heads/main"] },
 *   conditions: { StringNotLike: { sub: "repo:acme/app:pull_request" } },
 * });
 * ```
 */
export function openIdConnectPrincipal(
  opts: OpenIdConnectPrincipalOptions,
): OpenIdConnectPrincipal {
  const sources: [string, ClaimConditions | undefined][] = [
    ["StringEquals", opts.stringEquals],
    ["StringLike", opts.stringLike],
    ...Object.entries(opts.conditions ?? {}),
  ];

  const conditions: Record<string, RenderedConditions> = {};
  for (const [operator, claims] of sources) {
    // An operator block is created on its first key, so an empty map adds none.
    for (const [key, raw] of Object.entries(claims ?? {})) {
      const qualified = qualify(opts.issuerHost, key);
      const value = Array.isArray(raw)
        ? raw.map((v) => render(opts.issuerHost, v))
        : render(opts.issuerHost, raw);
      const merged = (conditions[operator] ??= {});
      // Of two equivalent values, the first spelling is kept, so the shorthand wins.
      if (!Object.hasOwn(merged, qualified)) {
        merged[qualified] = value;
      } else if (!sameValues(merged[qualified], value)) {
        throw new Error(
          `openIdConnectPrincipal: condition key "${qualified}" is given two different values ` +
            `under ${operator} (${JSON.stringify(merged[qualified])} and ${JSON.stringify(value)}).`,
        );
      }
    }
  }

  return new OpenIdConnectPrincipal(opts.provider, conditions);
}
