# Continuous Integration

This document describes the CI/CD pipeline for ComposureCDK: how it is structured, how to set up AWS access for deployment testing, and how to run parts of the pipeline locally.

## Pipeline overview

The pipeline is split into three stages, each in its own GitHub Actions workflow.

### Stage 1: CI (`.github/workflows/ci.yml`)

Runs on every push to `main` and on every pull request targeting `main`. Also callable by other workflows via `workflow_call`.

Steps (sequential, single job):

1. Checkout
2. `npm ci`
3. `npm run format:check`
4. `npm run typecheck`
5. `npm run build`
6. `npm run lint`
7. `npm run test`

The CI workflow is the quality gate for all other stages. Both the deploy-test and release workflows call it before proceeding.

### Stage 2: Deploy Test (`.github/workflows/deploy-test.yml`)

Manually triggered via `workflow_dispatch`. Deploys all example stacks to an AWS sandbox account, runs smoke tests, then tears everything down.

Steps:

1. Run the CI workflow as a prerequisite
2. Configure AWS credentials via OIDC federation
3. `npx cdk deploy --all` in the examples package
4. Run `scripts/smoke-test.mjs` to verify stack health and API endpoints
5. `npx cdk destroy --all --force` (runs even if earlier steps fail)

This workflow uses a GitHub Environment (`sandbox`) for protection rules and to store the `AWS_ROLE_ARN` and `AWS_REGION` variables.

### Stage 3: Release (`.github/workflows/release.yml`)

Triggered by pushing a version tag (`v*.*.*`). Currently stubbed — depends on the versioning strategy being finalised in issue #1.

## Stack naming convention

All example stacks use the `ComposureCDK-` prefix (e.g. `ComposureCDK-LambdaApiStack`, `ComposureCDK-MockApiStack`). This convention serves two purposes:

1. **IAM scoping** — The deploy-test IAM role restricts access to resources tagged with `aws:cloudformation:stack-name: ComposureCDK-*`. New examples are automatically covered by the policy as long as they follow the prefix.
2. **Smoke test discovery** — The smoke test finds stacks by prefix rather than enumerating names, so new examples are tested without script changes.

When adding a new example, use `ComposureCDK-` as the stack name prefix and the existing IAM policy and smoke test will cover it automatically.

## Setting up the sandbox account

The deploy-test workflow requires a one-time setup in your AWS account and GitHub repository.

### 1. Bootstrap CDK

If the target account/region has not been bootstrapped for CDK:

```sh
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

### 2. Deploy the OIDC stack

The CloudFormation template at `.github/cloudformation/github-oidc-role.yml` creates:

- A GitHub OIDC identity provider (or references an existing one)
- An IAM role with least-privilege permissions scoped to `ComposureCDK-*` stacks

Deploy it:

```sh
aws cloudformation deploy \
  --template-file .github/cloudformation/github-oidc-role.yml \
  --stack-name github-actions-oidc \
  --parameter-overrides GitHubOrg=laazyj RepoName=composureCDK \
  --capabilities CAPABILITY_NAMED_IAM
```

If the account already has a GitHub OIDC provider (from another project), pass its ARN to avoid a duplicate:

```sh
aws cloudformation deploy \
  --template-file .github/cloudformation/github-oidc-role.yml \
  --stack-name github-actions-oidc \
  --parameter-overrides \
    GitHubOrg=laazyj \
    RepoName=composureCDK \
    OIDCProviderArn=arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com \
  --capabilities CAPABILITY_NAMED_IAM
```

Then retrieve the `RoleArn` output — you will need it in the next step:

```sh
aws cloudformation describe-stacks \
  --stack-name github-actions-oidc \
  --query 'Stacks[0].Outputs[?OutputKey==`RoleArn`].OutputValue' \
  --output text
```

### 3. Configure the GitHub Environment

Create a GitHub Environment called `sandbox` on the repository with two variables:

| Variable       | Value                                          |
| -------------- | ---------------------------------------------- |
| `AWS_ROLE_ARN` | The `RoleArn` output from the OIDC stack       |
| `AWS_REGION`   | The region you bootstrapped (e.g. `eu-west-1`) |

Optionally add protection rules (e.g. required reviewers) to control when deployments run.

### 4. Trigger the workflow

Go to **Actions > Deploy Test > Run workflow**, select the `sandbox` environment, and run it.

## Running locally

### Full CI checks

```sh
npm run format:check
npm run typecheck
npm run build
npm run lint
npm run test
```

### Deploying examples to your own account

Make sure your AWS CLI credentials are configured for the target account, then:

```sh
npx nx build examples
npx nx deploy examples -- --all
```

### Smoke test

After deploying, run the smoke test against your environment:

```sh
node scripts/smoke-test.mjs
```

The script needs:

- **AWS CLI** installed and on your `PATH`
- **AWS credentials** configured (via environment variables, SSO, or `~/.aws/credentials`)
- **Region** set via `AWS_REGION`, `AWS_DEFAULT_REGION`, or `aws configure`

It will verify that all `ComposureCDK-*` stacks are healthy and that each API Gateway endpoint responds successfully.

### Tearing down

```sh
npx nx cdk examples -- destroy --all
```

## Security notes

- **OIDC federation** — No long-lived AWS credentials are stored in GitHub. The workflow assumes an IAM role via short-lived OIDC tokens.
- **Environment-scoped trust** — The IAM role's trust policy restricts assumption to the `sandbox` GitHub Environment, not the entire repository.
- **Tag-based resource scoping** — Lambda, CloudWatch Logs, and IAM permissions use `aws:cloudformation:stack-name` tag conditions to limit access to resources created by `ComposureCDK-*` stacks.
- **Action pinning** — All GitHub Actions are pinned by commit SHA (not tag) to prevent supply-chain attacks. Dependabot keeps these current.
- **Concurrency controls** — The deploy-test workflow uses `cancel-in-progress: false` to prevent cancelling in-flight deployments, which could leave stacks in an inconsistent state.
