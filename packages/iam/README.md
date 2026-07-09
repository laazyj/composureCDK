# @composurecdk/iam

IAM role, customer-managed policy, and policy-statement builders for [ComposureCDK](../../README.md).

This package provides fluent builders for the most commonly configured IAM resources and centralises least-privilege guardrails so that consuming packages (Lambda, Budgets, SNS topic policies, …) do not have to reinvent them.

## Role Builder

```ts
import { createRoleBuilder, createStatementBuilder } from "@composurecdk/iam";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";

const role = createRoleBuilder()
  .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
  .description("Execution role for the budget remediation Lambda")
  .addInlinePolicyStatements("StopEC2", [
    createStatementBuilder()
      .allow()
      .actions(["ec2:StopInstances", "ec2:DescribeInstances"])
      .resources(["*"])
      .allowWildcardResources(true),
  ])
  .build(stack, "StopEC2Role");
```

Every [RoleProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.RoleProps.html) property is available as a fluent setter. `assumedBy` and `permissionsBoundary` additionally accept a `Resolvable` (`Resolvable<IPrincipal>` and `Resolvable<IManagedPolicy>`), so a sibling component can supply the trust principal or boundary policy via `ref(...)`.

### Defaults

| Property             | Default             | Rationale                                                                                                     |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `maxSessionDuration` | `Duration.hours(1)` | Short-lived credentials reduce the blast radius of leaked sessions. See AWS Well-Architected Security pillar. |

Exported as `ROLE_DEFAULTS`.

### Result

```ts
interface RoleBuilderResult {
  role: Role;
  inlinePolicies: Record<string, PolicyDocument>; // keyed by the name passed to addInlinePolicyStatements
}
```

Inline policies are embedded in the underlying `AWS::IAM::Role` resource via its native `Policies` array — no separate `AWS::IAM::Policy` resources are created.

## Managed Policy Builder

```ts
import { createManagedPolicyBuilder } from "@composurecdk/iam";

const boundary = createManagedPolicyBuilder()
  .managedPolicyName("ops-boundary")
  .addStatements([
    createStatementBuilder()
      .allow()
      .actions(["s3:GetObject"])
      .resources(["arn:aws:s3:::my-bucket/*"]),
  ])
  .build(stack, "OpsBoundary");
```

## Statement Builder

`createStatementBuilder()` is a fluent wrapper around the CDK [PolicyStatement](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.PolicyStatement.html). Unlike the other builders in this package it is **not** a `Lifecycle` — its `build()` method returns a `PolicyStatement` synchronously.

### Wildcard guard

By default, `Allow` statements with `resources: ["*"]` fail with `WildcardResourceError`. Opt in explicitly with `.allowWildcardResources(true)` when an action genuinely requires unrestricted scope (such as `ec2:DescribeInstances`, which does not support resource-level permissions).

```ts
createStatementBuilder()
  .allow()
  .actions(["ec2:DescribeInstances"])
  .resources(["*"])
  .allowWildcardResources(true);
```

## Service Role Helper

```ts
import { createServiceRoleBuilder } from "@composurecdk/iam";

const lambdaRole = createServiceRoleBuilder("lambda.amazonaws.com")
  .description("Execution role for StopEC2 Lambda")
  .addInlinePolicyStatements("StopEC2", [/* statements */]);
```

Thin sugar over `createRoleBuilder().assumedBy(new ServicePrincipal(...))`.

## OIDC Federation

Let any OpenID Connect provider — GitHub Actions, GitLab, an EKS cluster, and so on — assume a role via `sts:AssumeRoleWithWebIdentity`, without long-lived credentials and without hand-writing the trust-policy condition map.

Build (or import) a provider, then scope a role's trust policy with `openIdConnectPrincipal()`. It prefixes each bare claim key with the issuer host (so you pass `aud`, not `oidc.example.com:aud`) and maps `stringEquals`/`stringLike` onto the trust-policy operators:

```ts
import {
  createOpenIdConnectProviderBuilder,
  openIdConnectPrincipal,
  createRoleBuilder,
} from "@composurecdk/iam";

const { provider } = createOpenIdConnectProviderBuilder()
  .url("https://oidc.example.com")
  .clientIds(["sts.amazonaws.com"])
  .build(stack, "OidcProvider");

const principal = openIdConnectPrincipal({
  provider,
  issuerHost: "oidc.example.com",
  stringEquals: { aud: "sts.amazonaws.com" },
  stringLike: { sub: ["repo:acme/app:ref:refs/heads/main"] },
});

createRoleBuilder().assumedBy(principal).build(stack, "DeployRole");
```

The builder wraps the L2 [OpenIdConnectProvider](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.OpenIdConnectProvider.html), which auto-fetches the provider's root-CA thumbprint, so a URL and audience are usually all you need.

### GitHub Actions

GitHub Actions is the common case, so its issuer, audience, and `sub`-claim shapes are provided as batteries under the `githubActions` sub-namespace — a thin layer over the primitives above, kept isolated from the general IAM API:

```ts
import { createRoleBuilder, githubActions } from "@composurecdk/iam";

const { provider } = githubActions.provider().build(stack, "GithubOidcProvider");

const { role } = createRoleBuilder()
  .assumedBy(
    githubActions.principal({
      owner: "acme",
      repo: "app",
      provider,
      subjects: [githubActions.Subject.branch("main"), githubActions.Subject.pullRequest()],
    }),
  )
  .build(stack, "GitHubActionsDeployRole");
```

`githubActions.principal()` pins the `aud` claim with `StringEquals` and scopes `sub` with `StringLike`, and requires at least one subject — a principal with no `sub` condition would trust every repository on GitHub. Build subjects with `Subject.branch(name)`, `.tag(pattern)`, `.pullRequest()`, `.environment(name)`, or `.custom(suffix)`.

Only one GitHub provider is allowed per account; if it already exists, reference it instead of creating a second with `githubActions.importProvider(stack, "GithubOidcProvider")`.
