import { type IOpenIdConnectProvider, OpenIdConnectPrincipal } from "aws-cdk-lib/aws-iam";

/**
 * Options for {@link openIdConnectPrincipal}.
 *
 * Claim keys are supplied bare (e.g. `"aud"`, `"sub"`); the helper prefixes
 * each with `${issuerHost}:` to form the fully-qualified trust-policy condition
 * key (e.g. `token.actions.githubusercontent.com:sub`). This removes the two
 * error-prone, security-critical steps of hand-writing the issuer prefix and
 * choosing the condition operator.
 */
export interface OpenIdConnectPrincipalOptions {
  /** The OIDC provider the role federates with. */
  readonly provider: IOpenIdConnectProvider;

  /**
   * The provider's issuer host, used to prefix every condition key — the
   * host portion of the issuer URL, without scheme
   * (e.g. `"token.actions.githubusercontent.com"`).
   */
  readonly issuerHost: string;

  /** Exact-match (`StringEquals`) claim conditions, keyed by bare claim name. */
  readonly stringEquals?: Record<string, string | string[]>;

  /** Pattern-match (`StringLike`) claim conditions, keyed by bare claim name. */
  readonly stringLike?: Record<string, string | string[]>;
}

/**
 * Builds an {@link OpenIdConnectPrincipal} for a web-identity (OIDC) trust
 * policy, prefixing every supplied claim key with `${issuerHost}:`.
 *
 * Provider-agnostic: use it directly for any OIDC IdP, or reach for the
 * {@link githubActions} helpers which layer the GitHub constants on top. The
 * returned principal is passed to `createRoleBuilder().assumedBy(...)`.
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
 * });
 * ```
 */
export function openIdConnectPrincipal(
  opts: OpenIdConnectPrincipalOptions,
): OpenIdConnectPrincipal {
  const prefix = (claims: Record<string, string | string[]>): Record<string, string | string[]> =>
    Object.fromEntries(
      Object.entries(claims).map(([claim, value]) => [`${opts.issuerHost}:${claim}`, value]),
    );

  const conditions: Record<string, Record<string, string | string[]>> = {};
  if (opts.stringEquals && Object.keys(opts.stringEquals).length > 0) {
    conditions.StringEquals = prefix(opts.stringEquals);
  }
  if (opts.stringLike && Object.keys(opts.stringLike).length > 0) {
    conditions.StringLike = prefix(opts.stringLike);
  }

  return new OpenIdConnectPrincipal(opts.provider, conditions);
}
