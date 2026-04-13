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

Every [RoleProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.RoleProps.html) property is available as a fluent setter. `permissionsBoundary` additionally accepts a `Resolvable<IManagedPolicy>` so a sibling component can supply a boundary policy via `ref(...)`.

### Defaults

| Property             | Default             | Rationale                                                                                                     |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `maxSessionDuration` | `Duration.hours(1)` | Short-lived credentials reduce the blast radius of leaked sessions. See AWS Well-Architected Security pillar. |

Exported as `ROLE_DEFAULTS`.

### Result

```ts
interface RoleBuilderResult {
  role: Role;
  inlinePolicies: Record<string, Policy>; // keyed by the name passed to addInlinePolicyStatements
}
```

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
  .addInlinePolicyStatements("StopEC2", [
    /* statements */
  ]);
```

Thin sugar over `createRoleBuilder().assumedBy(new ServicePrincipal(...))`.
