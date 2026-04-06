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

Triggered by pushing a version tag (`v*.*.*`). Runs the full deploy-test pipeline (which includes CI) as a quality gate, then publishes all public packages to npm with provenance.

Steps:

1. Run the deploy-test workflow (CI → deploy → smoke test → destroy)
2. Build all packages
3. `npx nx release publish` to publish to npm

This workflow uses a GitHub Environment (`npm`) and [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) (OIDC) for authentication — no long-lived npm tokens. Provenance attestations are generated automatically, cryptographically linking each published package to this repository and workflow run.

## Versioning

All publishable packages share a single version number (fixed versioning). When any package changes, all are bumped and published together. This guarantees compatibility — `@composurecdk/apigateway@0.5.0` always works with `@composurecdk/core@0.5.0`.

The `@composurecdk/examples` package is excluded from releases because it is `"private": true` — it exists for reference, not as an installable library.

Version bumps are determined automatically from conventional commit messages:

| Commit prefix      | Version bump |
| ------------------ | ------------ |
| `fix:`             | Patch        |
| `feat:`            | Minor        |
| `BREAKING CHANGE:` | Major        |

### Creating a release

```sh
npx nx release --dry-run        # preview version bump, changelog, and tag
npx nx release                  # bump versions, generate changelog, commit, tag, push
```

This command:

1. Determines the next version from conventional commits since the last tag
2. Updates every `package.json` version and cross-package peer dependency ranges
3. Generates/updates `CHANGELOG.md`
4. Commits the changes and creates a `v*.*.*` git tag
5. Creates a GitHub Release with the changelog

Publishing is disabled locally (`"publish": false` in `nx.json`). The tag push triggers the release workflow, which runs CI and then publishes to npm via `npx nx release publish`.

### Bumping the minor version in 0.x (breaking change)

SemVer treats the minor segment of a `0.x` version like a major version — `^0.1.0` means `>=0.1.0 <0.2.0`. Because of this, `nx release` cannot automatically update cross-package peer dependency ranges when the minor version changes: the new version falls outside the existing `^0.x.0` range and the `preserveMatchingDependencyRanges` safety check blocks the release.

To release a new minor version (e.g. `0.1.x` → `0.2.0`):

1. Update every internal `@composurecdk/*` peer dependency range to match the new minor:

   ```sh
   # macOS sed — adjust -i flag for GNU sed
   for f in packages/*/package.json; do
     sed -i '' 's/"@composurecdk\/\([^"]*\)": "\^0\.1\.0"/"@composurecdk\/\1": "^0.2.0"/g' "$f"
   done
   ```

2. Run the release with an explicit version specifier:

   ```sh
   npx nx release --specifier=0.2.0 --dry-run   # preview first
   npx nx release --specifier=0.2.0              # bump, changelog, commit, tag, push
   ```

The `--specifier` flag overrides the conventional-commits auto-detection and sets the exact version. The `nx release` command will update every `package.json` version, generate the changelog, commit, tag, and push — the peer dependency ranges you updated in step 1 are included in the same commit.

For patch releases within the same minor (e.g. `0.2.0` → `0.2.1`), the standard `npx nx release` workflow works as normal because the new version stays within the existing `^0.2.0` range.

### npm publishing setup

Publishing uses [trusted publishers](https://docs.npmjs.com/trusted-publishers/) (OIDC) — no long-lived npm tokens to manage.

**One-time setup:**

1. Create the `@composurecdk` organisation on [npmjs.com](https://www.npmjs.com) (free plan, public packages)
2. Create a GitHub Environment called `npm` on the repository
3. Do an initial publish to create the packages on npm (this must be done locally before trusted publishers can be configured). If your npm account has 2FA enabled, use a granular access token with the **Automation** type to bypass the OTP prompt:

   ```sh
   # Option A: use an automation token (recommended — avoids OTP prompt)
   npm config set //registry.npmjs.org/:_authToken=YOUR_AUTOMATION_TOKEN
   npx nx release publish
   npm config delete //registry.npmjs.org/:_authToken

   # Option B: pass an OTP code from your authenticator app
   npm login
   npx nx release publish -- --otp=CODE
   ```

4. Configure a trusted publisher for each package:
   ```sh
   npm trust github @composurecdk/<name> --file release.yml --repo laazyj/composureCDK --env npm
   ```

**Adding a new package:**

1. Add `"publishConfig": { "access": "public" }` to its `package.json`
2. Publish it once locally (same authentication options as the one-time setup above):
   ```sh
   npm config set //registry.npmjs.org/:_authToken=YOUR_AUTOMATION_TOKEN
   npx nx release publish
   npm config delete //registry.npmjs.org/:_authToken
   ```
3. Configure its trusted publisher using the `npm trust github` command above

After that, the release workflow handles all future publishes automatically.

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

Run all checks in one command:

```sh
npm run verify
```

Or individually:

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

- **OIDC everywhere** — Both AWS and npm use OIDC federation. No long-lived credentials or tokens are stored in GitHub.
- **Environment-scoped trust** — The AWS IAM role restricts assumption to the `sandbox` GitHub Environment. npm trusted publishers restrict publishing to the `release.yml` workflow in the `npm` environment.
- **Tag-based resource scoping** — Lambda, CloudWatch Logs, and IAM permissions use `aws:cloudformation:stack-name` tag conditions to limit access to resources created by `ComposureCDK-*` stacks.
- **npm provenance** — Published packages include provenance attestations, cryptographically linking them to this repository and the specific workflow run that produced them.
- **Action pinning** — All GitHub Actions are pinned by commit SHA (not tag) to prevent supply-chain attacks. Dependabot keeps these current.
- **Concurrency controls** — The deploy-test workflow uses `cancel-in-progress: false` to prevent cancelling in-flight deployments, which could leave stacks in an inconsistent state.
