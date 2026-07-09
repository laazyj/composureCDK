import { Stack } from "aws-cdk-lib";
import {
  type IOpenIdConnectProvider,
  OpenIdConnectPrincipal,
  OpenIdConnectProvider,
} from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import {
  createOpenIdConnectProviderBuilder,
  type IOpenIdConnectProviderBuilder,
} from "./open-id-connect-provider-builder.js";
import { openIdConnectPrincipal } from "./open-id-connect-principal.js";

/**
 * GitHub Actions OIDC batteries, exposed under the `githubActions` sub-namespace
 * (`import { githubActions } from "@composurecdk/iam"`) to keep the
 * GitHub-specific surface isolated from the general IAM API.
 *
 * These helpers layer the GitHub constants on the general OIDC primitives
 * ({@link createOpenIdConnectProviderBuilder}, {@link openIdConnectPrincipal})
 * so consumers stop hand-rolling the security-critical trust policy.
 *
 * @example
 * ```ts
 * import { createRoleBuilder, githubActions } from "@composurecdk/iam";
 *
 * const { provider } = githubActions.provider().build(stack, "GithubOidcProvider");
 * const { role } = createRoleBuilder()
 *   .assumedBy(
 *     githubActions.principal({
 *       owner: "acme",
 *       repo: "app",
 *       provider,
 *       subjects: [githubActions.Subject.branch("main"), githubActions.Subject.pullRequest()],
 *     }),
 *   )
 *   .build(stack, "GitHubActionsDeployRole");
 * ```
 *
 * @module
 */

/** The GitHub Actions OIDC issuer URL (the `iss` claim of its ID tokens). */
const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";

/** The GitHub Actions issuer host, used to prefix trust-policy condition keys. */
const GITHUB_OIDC_ISSUER_HOST = "token.actions.githubusercontent.com";

/** The default audience (`aud`) for GitHub Actions → AWS STS federation. */
const GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com";

/**
 * Produces a GitHub OIDC `sub`-claim string for a `owner/repo` slug. This is
 * the trust-policy security boundary — it decides which workflows may assume
 * the role. Use the {@link Subject} constructors rather than hand-writing
 * these strings.
 */
export type SubjectFactory = (ownerRepo: string) => string;

/**
 * Type-safe constructors for GitHub Actions OIDC `sub` claims, covering the
 * standard workflow-scoping shapes.
 *
 * @see https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#example-subject-claims
 *
 * @example
 * ```ts
 * githubActions.Subject.branch("main");        // repo:acme/app:ref:refs/heads/main
 * githubActions.Subject.pullRequest();         // repo:acme/app:pull_request
 * githubActions.Subject.environment("prod");   // repo:acme/app:environment:prod
 * githubActions.Subject.tag("v*");             // repo:acme/app:ref:refs/tags/v*
 * ```
 */
export const Subject = {
  /** A push to the named branch: `repo:<owner>/<repo>:ref:refs/heads/<name>`. */
  branch:
    (name: string): SubjectFactory =>
    (ownerRepo) =>
      `repo:${ownerRepo}:ref:refs/heads/${name}`,

  /** A push of the matching tag: `repo:<owner>/<repo>:ref:refs/tags/<pattern>`. */
  tag:
    (pattern: string): SubjectFactory =>
    (ownerRepo) =>
      `repo:${ownerRepo}:ref:refs/tags/${pattern}`,

  /** A pull-request run: `repo:<owner>/<repo>:pull_request`. */
  pullRequest: (): SubjectFactory => (ownerRepo) => `repo:${ownerRepo}:pull_request`,

  /** A deployment to the named GitHub Environment: `repo:<owner>/<repo>:environment:<name>`. */
  environment:
    (name: string): SubjectFactory =>
    (ownerRepo) =>
      `repo:${ownerRepo}:environment:${name}`,

  /** An escape hatch for any other claim suffix: `repo:<owner>/<repo>:<suffix>`. */
  custom:
    (suffix: string): SubjectFactory =>
    (ownerRepo) =>
      `repo:${ownerRepo}:${suffix}`,
} as const;

/**
 * Options for {@link principal}.
 */
export interface PrincipalOptions {
  /** The repository owner (user or organisation). */
  readonly owner: string;

  /** The repository name. */
  readonly repo: string;

  /**
   * The GitHub OIDC provider the role federates with — build one with
   * {@link provider} or reference the account singleton with
   * {@link importProvider}.
   */
  readonly provider: IOpenIdConnectProvider;

  /**
   * The workflow scopes allowed to assume the role. **At least one is
   * required** — an empty list would trust every workflow in the repository's
   * account namespace. Build entries with {@link Subject}.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_permissions_reduce_permissions.html
   */
  readonly subjects: SubjectFactory[];

  /** Override the audience (`aud`); defaults to `sts.amazonaws.com`. */
  readonly audience?: string;
}

/**
 * Builds a GitHub Actions OIDC principal for `createRoleBuilder().assumedBy(...)`.
 *
 * Encodes the GitHub issuer host and pins the audience with `StringEquals`
 * while scoping `sub` with `StringLike`, so callers cannot accidentally pick
 * the wrong operator or forget the audience guard. The subject list is the
 * security boundary and must be non-empty.
 *
 * @throws when `subjects` is empty, or `owner`/`repo` is empty or contains "/".
 */
export function principal(opts: PrincipalOptions): OpenIdConnectPrincipal {
  for (const [label, value] of [
    ["owner", opts.owner],
    ["repo", opts.repo],
  ] as const) {
    if (!value || value.includes("/")) {
      throw new Error(
        `githubActions.principal: ${label} must be a non-empty value without "/" (got "${value}").`,
      );
    }
  }

  if (opts.subjects.length === 0) {
    throw new Error(
      "githubActions.principal: at least one subject is required. A GitHub OIDC principal " +
        "with no `sub` condition trusts every repository on GitHub. Scope it with " +
        "githubActions.Subject.branch(...), .pullRequest(), .environment(...), etc. See " +
        "https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_permissions_reduce_permissions.html",
    );
  }

  const ownerRepo = `${opts.owner}/${opts.repo}`;
  return openIdConnectPrincipal({
    provider: opts.provider,
    issuerHost: GITHUB_OIDC_ISSUER_HOST,
    stringEquals: { aud: opts.audience ?? GITHUB_OIDC_AUDIENCE },
    stringLike: { sub: opts.subjects.map((subject) => subject(ownerRepo)) },
  });
}

/**
 * A {@link createOpenIdConnectProviderBuilder | provider builder} preset with
 * the GitHub Actions issuer URL and audience. Every value stays overridable via
 * the fluent API.
 *
 * Only one GitHub OIDC provider may exist per account — if one already exists,
 * reference it with {@link importProvider} instead of building a second.
 *
 * @example
 * ```ts
 * const { provider } = githubActions.provider().build(stack, "GithubOidcProvider");
 * ```
 */
export function provider(): IOpenIdConnectProviderBuilder {
  return createOpenIdConnectProviderBuilder()
    .url(GITHUB_OIDC_URL)
    .clientIds([GITHUB_OIDC_AUDIENCE]);
}

/**
 * Imports the account-singleton GitHub Actions OIDC provider by its
 * conventional ARN, so callers never hand-write the ARN format.
 *
 * @example
 * ```ts
 * const provider = githubActions.importProvider(stack, "GithubOidcProvider");
 * ```
 */
export function importProvider(scope: IConstruct, id: string): IOpenIdConnectProvider {
  const arn = `arn:aws:iam::${Stack.of(scope).account}:oidc-provider/${GITHUB_OIDC_ISSUER_HOST}`;
  return OpenIdConnectProvider.fromOpenIdConnectProviderArn(scope, id, arn);
}
