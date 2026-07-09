import { OpenIdConnectProvider, type OpenIdConnectProviderProps } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";

/**
 * Configuration properties for the {@link createOpenIdConnectProviderBuilder | OIDC provider builder}.
 *
 * Aliases the CDK {@link OpenIdConnectProviderProps} unchanged — the builder
 * adds no properties of its own, only the fluent surface and a validated
 * {@link IOpenIdConnectProviderBuilder.build | build}.
 */
export type OpenIdConnectProviderBuilderProps = OpenIdConnectProviderProps;

/**
 * The build output of an {@link IOpenIdConnectProviderBuilder}.
 */
export interface OpenIdConnectProviderBuilderResult {
  /** The OIDC identity provider construct created by the builder. */
  provider: OpenIdConnectProvider;
}

/**
 * A fluent builder for configuring and creating an IAM OIDC identity provider.
 *
 * Establishes trust between the account and an external OpenID Connect
 * identity provider (GitHub Actions, GitLab, Terraform Cloud, an EKS cluster,
 * any OIDC-compatible IdP), so roles can be assumed via
 * `sts:AssumeRoleWithWebIdentity` without long-lived credentials. Pair the
 * built provider with {@link openIdConnectPrincipal} (or the
 * {@link githubActions} helpers) to scope the trust policy.
 *
 * Wraps the L2 {@link OpenIdConnectProvider}, which auto-fetches the provider's
 * root-CA thumbprint when none is supplied — so the common case requires only
 * a URL and audience.
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html
 *
 * @example
 * ```ts
 * const { provider } = createOpenIdConnectProviderBuilder()
 *   .url("https://token.actions.githubusercontent.com")
 *   .clientIds(["sts.amazonaws.com"])
 *   .build(stack, "GithubOidcProvider");
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- OpenIdConnectProvider is an L2 custom resource that exposes no taggable props surface
export type IOpenIdConnectProviderBuilder = IBuilder<
  OpenIdConnectProviderBuilderProps,
  OpenIdConnectProviderBuilder
>;

class OpenIdConnectProviderBuilder implements Lifecycle<OpenIdConnectProviderBuilderResult> {
  props: Partial<OpenIdConnectProviderBuilderProps> = {};

  build(scope: IConstruct, id: string): OpenIdConnectProviderBuilderResult {
    const { url, ...rest } = this.props;

    if (!url) {
      throw new Error(
        `OpenIdConnectProviderBuilder "${id}": url(...) must be called before build(). ` +
          `An OIDC provider requires the issuer URL (the \`iss\` claim of its tokens).`,
      );
    }

    if (!url.startsWith("https://")) {
      throw new Error(
        `OpenIdConnectProviderBuilder "${id}": url must begin with "https://" (got "${url}"). ` +
          `See https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html`,
      );
    }

    const provider = new OpenIdConnectProvider(scope, id, { ...rest, url });
    return { provider };
  }
}

/**
 * Creates a new {@link IOpenIdConnectProviderBuilder} for configuring an IAM
 * OIDC identity provider.
 *
 * @returns A fluent builder for an OIDC identity provider.
 */
export function createOpenIdConnectProviderBuilder(): IOpenIdConnectProviderBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- OpenIdConnectProvider is an L2 custom resource that exposes no taggable props surface
  return Builder<OpenIdConnectProviderBuilderProps, OpenIdConnectProviderBuilder>(
    OpenIdConnectProviderBuilder,
  );
}
