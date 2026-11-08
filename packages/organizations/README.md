# @composurecdk/organizations

AWS Organizations builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for **service control policies** (SCPs). CDK ships no Organizations L2, so the builder wraps the [`CfnPolicy`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_organizations.CfnPolicy.html) L1 construct, following the same pattern as `@composurecdk/budgets`: typed setters, synth-time validation, and builder tags.

## Before you deploy

- **Deploy from the management account**, or from a member account that is a [delegated administrator for policy management](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_delegate_policies.html). `CreatePolicy` and `AttachPolicy` work nowhere else.
- **Enable the SCP policy type on the root** first. This is a one-time step, done in the console or with `aws organizations enable-policy-type --root-id r-xxxx --policy-type SERVICE_CONTROL_POLICY`. CloudFormation has no resource for it, and the builder does not automate it: `DisablePolicyType` detaches every SCP in the organization, so no single stack should own it.
- **Turn on termination protection** for the stack that holds your organization's guardrails. Deleting that stack detaches every SCP in it.
- **Validate before deploying.** IAM Access Analyzer's [`ValidatePolicy`](https://docs.aws.amazon.com/access-analyzer/latest/APIReference/API_ValidatePolicy.html) accepts `policyType: SERVICE_CONTROL_POLICY`. [`cfn-policy-validator`](https://github.com/awslabs/aws-cloudformation-iam-policy-validator) runs it over a synthesised template. The builder doesn't call it, because synth stays offline.

## How SCPs behave

SCPs [grant nothing](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html). They set the most an identity policy in a member account can allow. A `Deny` anywhere on the path from the root to the account wins, and an action must be allowed at every level.

- **Start with deny lists.** Leave the AWS-managed `FullAWSAccess` SCP attached everywhere and add `Deny` policies alongside it. That is AWS's recommended starting point. The builder never detaches `FullAWSAccess`. If you move to allow lists, managing `FullAWSAccess` is your job: removing it without an `Allow` replacement blocks every action in the affected accounts.
- **SCPs do not apply to the management account**, nor to service-linked roles. Attaching a policy to the root does not protect the management account.
- **Test on a test OU first.** Attach a new SCP to an OU holding a test account before attaching it to production OUs or the root.

## Service Control Policy Builder

```ts
import { createStatementBuilder } from "@composurecdk/iam";
import { createServiceControlPolicyBuilder, target } from "@composurecdk/organizations";

const { policy, document } = createServiceControlPolicyBuilder()
  .name("SandboxGuardrails")
  .description("Guardrails for the sandbox OU")
  .addStatements([
    createStatementBuilder()
      .sid("DenyLeaveOrg")
      .deny()
      .actions(["organizations:LeaveOrganization"])
      .resources(["*"]),
    createStatementBuilder()
      .sid("DenyLargeInstances")
      .deny()
      .actions(["ec2:RunInstances"])
      .resources(["arn:aws:ec2:*:*:instance/*"])
      .conditions({ StringNotLike: { "ec2:InstanceType": ["t3.*", "t4g.*"] } }),
  ])
  .exceptPrincipals(["arn:aws:iam::*:role/OrganizationAccountAccessRole"])
  .attachTo([target.ou("ou-ab12-cdef3456")])
  .tag("project", "sandbox")
  .build(stack, "SandboxGuardrails");
```

`Type` is always `SERVICE_CONTROL_POLICY`. The result exposes the `CfnPolicy` and the `PolicyDocument` that is its `Content`.

| Method                         | Purpose                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name(string)`                 | The policy's `Name`. Required; 1 to 128 characters.                                                                                                         |
| `description(string)`          | The policy's `Description`. Up to 512 characters.                                                                                                           |
| `addStatements([...])`         | Statements, as `@composurecdk/iam` statement builders or CDK `PolicyStatement`s. Repeated calls add to the list.                                            |
| `exceptPrincipals([...])`      | Exempts principals from every `Deny` statement, by adding `ArnNotLike: { "aws:PrincipalArn": [...] }`. Use it for break-glass and pipeline roles.           |
| `attachTo([...])`              | The policy's `TargetIds`. Takes `target.root(id)`, `target.ou(id)`, `target.account(id)`, or a `ref` to a sibling that produces one. Calls add to the list. |
| `detached()`                   | Creates the policy without attaching it. See below.                                                                                                         |
| `tag(key, value)` / `tags({})` | Tags the policy.                                                                                                                                            |

### Statements

SCPs [support the full IAM policy language](https://aws.amazon.com/about-aws/whats-new/2025/09/aws-organizations-iam-language-service-control-policies/), so the builder reuses IAM statements instead of a second statement DSL. A statement builder's wildcard-resource guard still runs, which matters for allow-list SCPs: an `Allow` on `"*"` needs `allowWildcardResources(true)`.

`Principal` and `NotPrincipal` are the one part of the IAM grammar SCPs [do not support](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html). Scope principals with an `aws:PrincipalArn` condition instead, which is what `exceptPrincipals` writes. `exceptPrincipals` merges with any conditions a statement already has, and leaves the caller's `PolicyStatement` unchanged.

### Targets

`target.root`, `target.ou` and `target.account` check the ID's format where you call them, so a typo fails at synth with the expected format in the message, not at deploy. A value holding an unresolved token is passed through unchecked. The builder checks every target again at build, which also covers values from a `ref`.

Organizational units are not created by this package. Pass their IDs in, for example from configuration or the environment.

### Synth-time checks

`build()` throws when:

- `name` is unset, or the name or description is too long;
- the policy has no statements;
- a statement has a `Principal` or `NotPrincipal`, or no action;
- a target ID is malformed;
- the policy has no targets and `detached()` wasn't called, or has targets and `detached()` was called;
- the document is longer than `SERVICE_CONTROL_POLICY_QUOTAS.maxCharacters`. That's 10,240 characters, measured as CloudFormation sends the document: resolved, so merged where `@aws-cdk/aws-iam:minimizePolicies` is on, and minified. AWS [raised the limit from 5,120 in May 2026](https://aws.amazon.com/about-aws/whats-new/2026/05/aws-organizations-increased-scp-quotas/). The check is skipped when the document holds an unresolved token.

**Why a policy with no targets throws.** A detached SCP deploys and does nothing, and nothing reports that it does nothing. Call `detached()` when you mean it, for example to stage a policy before you attach it.

### Several guardrails in one policy

Each root, OU and account can have [at most 10 SCPs attached](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html), and `FullAWSAccess` takes one of them. To save attachment slots, put several guardrails in one policy. The size check is what makes this safe.

## Constraints

`constraints.validate` exposes this package's validators: `policyName`, `policyDescription`, `rootId`, `organizationalUnitId`, `accountId` and `policyTargetId`. See [ADR-0010](../../docs/adr/0010-aws-property-constraints.md).
