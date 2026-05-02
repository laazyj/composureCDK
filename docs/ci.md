# Continuous Integration

CI/CD pipeline for ComposureCDK: how the workflows chain, how to bootstrap AWS and npm access, and how to cut a release.

## Pipeline overview

Five GitHub Actions workflows chain together:

```
ci.yml ──► deploy-test.yml ──► release.yml
   ▲              ▲                ▲
   │              │                │
 PRs/push    workflow_dispatch  release-tag.yml ◄── push to main
                                                    (filters chore(release): commits)
                                ▲
                                │
                          release-prepare.yml (workflow_dispatch → opens PR)
```

- **`ci.yml`** — runs format/typecheck/build/lint/test on every push and PR. Also `workflow_call`-able. Quality gate for everything downstream.
- **`deploy-test.yml`** — manual `workflow_dispatch`. Calls CI, then deploys all example stacks to the `sandbox` environment via OIDC, runs `scripts/smoke-test.mjs`, and exits. Teardown runs separately in `sandbox-cleanup.yml` so developer feedback lands in ~10 min instead of waiting on CloudFront propagation.
- **`release-prepare.yml`** — manual `workflow_dispatch`. Runs `nx release version` + `nx release changelog`, pushes branch `release/vX.Y.Z`, opens a PR titled `chore(release): vX.Y.Z`. The PR is the integration point that lets release coexist with branch protection on `main`.
- **`release-tag.yml`** — runs on every push to `main`. If the head commit subject matches `chore(release): vX.Y.Z` (squash-merge required), it tags the commit, creates a GitHub Release from the matching `CHANGELOG.md` section, and invokes `release.yml`. Otherwise no-op. The tag is pushed with the default `GITHUB_TOKEN` so it does not double-fire `release.yml`'s `push: tags` trigger.
- **`release.yml`** — invoked by `release-tag.yml` via `workflow_call`; also triggered by manual `v*.*.*` tag pushes as an escape hatch. Runs deploy-test, then `npx nx release publish` to npm with provenance, authenticated via [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) (OIDC) in the `npm` environment.

## Versioning

Fixed versioning across all packages — when any package changes, all bump together, so `@composurecdk/apigateway@0.5.0` always works with `@composurecdk/core@0.5.0`. `@composurecdk/examples` is versioned alongside the rest but marked `"private": true` so it is never published.

Bumps are derived from [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) since the previous tag:

| Commit shape                          | Version bump |
| ------------------------------------- | ------------ |
| `fix: …`                              | Patch        |
| `feat: …`                             | Minor        |
| Any type with `!` (e.g. `feat!: …`)   | Major        |
| `BREAKING CHANGE:` footer in the body | Major        |

Scopes are optional and do not affect the bump.

### Creating a release

1. **Preview locally.**

   ```sh
   npx nx release --dry-run
   ```

   Prints the planned version, changelog, and per-package bumps. Safe any time. `nx.json` sets `release.git.commit/tag/push` to `false`, so a non-`--dry-run` local invocation modifies files but does not commit, tag, or push — `git restore` undoes it.

2. **Open the release PR.** Trigger **Actions → Release Prepare → Run workflow**:
   - Leave inputs blank for a normal conventional-commits-driven release.
   - Set `specifier` (e.g. `0.6.1`) to force an exact version.
   - Set `specifier` _and_ tick `bump-peer-deps` for any 0.x minor bump (see below).

3. **Review and merge.** CI runs against the PR; squash-merge it once green. (The release-tag filter assumes the release commit is HEAD on `main`.)

4. **Tag, deploy-test, publish — automatic.** `release-tag.yml` tags the commit and invokes `release.yml`, which runs deploy-test then publishes to npm.

#### Bumping the minor version in 0.x (breaking change)

SemVer treats the minor segment of a `0.x` version like a major: `^0.1.0` means `>=0.1.0 <0.2.0`. `nx release` therefore cannot auto-update cross-package peer-dep ranges across a 0.x minor bump — `preserveMatchingDependencyRanges` blocks it.

For a 0.x minor bump (e.g. `0.5.x` → `0.6.0`), trigger **Release Prepare** with both inputs:

| Input            | Value   |
| ---------------- | ------- |
| `specifier`      | `0.6.0` |
| `bump-peer-deps` | ✓       |

The workflow rewrites every internal `@composurecdk/*` peer-dep range to `^0.6.0` before versioning, then runs `nx release version --specifier=0.6.0`. All changes land in a single `chore(release): v0.6.0` commit.

Patch releases within the same minor (`0.6.0` → `0.6.1`) need neither input.

#### Manual fallback and PR auto-trigger

`release.yml` keeps its `push: tags: v*.*.*` trigger as an escape hatch — pushing a `vX.Y.Z` tag (typically by an admin with permission to push tags through branch protection) bypasses the automated chain.

By default `release-prepare.yml` uses `GITHUB_TOKEN`, and per [GitHub's rules][gha-token-rules] PRs opened by that token do not trigger `pull_request` workflows — so CI will not run on the release PR until someone closes-and-reopens it or pushes a commit. To auto-trigger, create a fine-grained PAT (or GitHub App) with `contents:write` and `pull_requests:write` and store it as repository secret `RELEASE_PR_TOKEN`. The workflow falls back to it if present.

[gha-token-rules]: https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow

### npm publishing setup

Publishing uses [trusted publishers](https://docs.npmjs.com/trusted-publishers/) (OIDC) — no long-lived npm tokens. Trusted publishers cannot be configured until each package exists on the registry, so the first publish must use token or OTP auth.

**One-time setup:**

1. Create the `@composurecdk` org on [npmjs.com](https://www.npmjs.com).
2. Create a GitHub Environment called `npm` on the repository.
3. Initial publish from a local checkout:

   ```sh
   # Option A: granular access token, type "Automation" (no OTP prompt),
   # scoped to the @composurecdk org.
   npm config set //registry.npmjs.org/:_authToken=YOUR_AUTOMATION_TOKEN
   npx nx release publish
   npm config delete //registry.npmjs.org/:_authToken

   # Option B: OTP from authenticator app
   npm login
   npx nx release publish --otp=CODE
   ```

4. Configure a trusted publisher for each package:

   ```sh
   npm trust github @composurecdk/<name> --file release.yml --repo laazyj/composureCDK --env npm
   ```

**Adding a new package:**

1. Add `"publishConfig": { "access": "public" }` to its `package.json`.
2. Publish only the new package once (full `release publish` would fail on already-published packages):

   ```sh
   # Option A: automation token
   npm config set //registry.npmjs.org/:_authToken=YOUR_AUTOMATION_TOKEN
   npx nx run @composurecdk/<name>:nx-release-publish
   npm config delete //registry.npmjs.org/:_authToken

   # Option B: OTP
   npx nx run @composurecdk/<name>:nx-release-publish --otp=CODE
   ```

3. Configure its trusted publisher (same `npm trust` command as above).

## Stack naming convention

All example stacks use the `ComposureCDK-` prefix (e.g. `ComposureCDK-MockApiStack`). The deploy-test IAM role scopes permissions via the `aws:cloudformation:stack-name: ComposureCDK-*` tag condition, and the smoke test discovers stacks by prefix — new examples are covered automatically.

## Setting up the sandbox account

One-time setup for the deploy-test workflow.

### 1. Bootstrap CDK

```sh
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

### 2. Deploy the OIDC stack

`.github/cloudformation/github-oidc-role.yml` creates a GitHub OIDC provider (or references an existing one) and a least-privilege IAM role scoped to `ComposureCDK-*` stacks.

```sh
aws cloudformation deploy \
  --template-file .github/cloudformation/github-oidc-role.yml \
  --stack-name github-actions-oidc \
  --parameter-overrides GitHubOrg=laazyj RepoName=composureCDK \
  --capabilities CAPABILITY_NAMED_IAM
```

If the account already has a GitHub OIDC provider, pass its ARN to avoid a duplicate:

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

Retrieve the `RoleArn` output:

```sh
aws cloudformation describe-stacks \
  --stack-name github-actions-oidc \
  --query 'Stacks[0].Outputs[?OutputKey==`RoleArn`].OutputValue' \
  --output text
```

### 3. Configure the GitHub Environment

Create a GitHub Environment called `sandbox` with:

| Variable       | Value                                          |
| -------------- | ---------------------------------------------- |
| `AWS_ROLE_ARN` | The `RoleArn` output from the OIDC stack       |
| `AWS_REGION`   | The region you bootstrapped (e.g. `eu-west-1`) |

Add protection rules (e.g. required reviewers) as desired.

### 4. Trigger the workflow

**Actions → Deploy Test → Run workflow**, select `sandbox`.

## Running locally

```sh
npm run verify         # all CI checks in one go
npm run format:check   # or run individually
npm run typecheck
npm run build
npm run lint
npm run test
```

Deploy examples to your own account:

```sh
npx nx build examples
npx nx deploy examples -- --all
```

Run the smoke test against your environment (needs AWS CLI on `PATH`, credentials configured, region set via `AWS_REGION` / `AWS_DEFAULT_REGION` / `aws configure`):

```sh
node scripts/smoke-test.mjs
```

It verifies all `ComposureCDK-*` stacks are healthy and that each API Gateway endpoint responds. Tear down with:

```sh
npx nx cdk examples -- destroy --all
```

## Security notes

- **OIDC everywhere** — both AWS and npm. No long-lived credentials in GitHub.
- **Environment-scoped trust** — the AWS role restricts assumption to the `sandbox` environment; npm trusted publishers restrict publishing to `release.yml` in the `npm` environment.
- **Tag-based resource scoping** — Lambda, CloudWatch Logs, and IAM permissions use `aws:cloudformation:stack-name` tag conditions limited to `ComposureCDK-*`.
- **npm provenance** — published packages include provenance attestations linking them to this repo and workflow run.
- **Action pinning** — all GitHub Actions are pinned by commit SHA, kept current by Dependabot.
- **Concurrency** — deploy-test uses `cancel-in-progress: false` so an in-flight deployment cannot be interrupted into an inconsistent state.
