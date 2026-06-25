# Continuous Integration

CI/CD pipeline for ComposureCDK: how the workflows chain, how to bootstrap AWS and npm access, and how to cut a release.

## Pipeline overview

Five GitHub Actions workflows chain together:

```
ci.yml ──► deploy-test.yml ──► release.yml ◄── tag push (PAT or manual)
   ▲              ▲                              ▲
   │              │                              │
 PRs/push    workflow_dispatch /            release-tag.yml ◄── push to main
             PR (examples)
                                            (filters chore(release): commits,
                                             pushes tag with RELEASE_PR_TOKEN)
                                                  ▲
                                                  │
                                          release-prepare.yml (workflow_dispatch → opens PR)
```

- **`ci.yml`** — runs format/typecheck/build/`check:exports`/lint/test on a Node 20 + 24 matrix, on every push and PR. Also `workflow_call`-able. Quality gate for everything downstream. The steps are just `npm run` scripts — the same ones `npm run verify` chains locally — so CI executes the gate, it does not _define_ it (see [ADR-0007](adr/0007-dual-esm-cjs-publishing.md)).
- **`deploy-test.yml`** — manual `workflow_dispatch`, plus automatic on PRs to `main` that touch `packages/examples/**` (or the workflow itself), for early validation that the example apps still deploy. Calls CI, then deploys all example stacks to the `sandbox` environment via OIDC, runs `scripts/smoke-test.mjs`, and exits. On the `pull_request` trigger `inputs.environment` is unset, so the deploy job falls back to `sandbox`. PR runs share the `sandbox-account-sandbox` concurrency group with `workflow_dispatch` runs and `sandbox-cleanup.yml`, so deploys serialise against the single sandbox account rather than racing. Teardown runs separately in `sandbox-cleanup.yml` (triggered by `workflow_run` on this workflow, so auto-runs are cleaned up too) so developer feedback lands in ~10 min instead of waiting on CloudFront propagation. Which PRs actually deploy is gated — see [Who can deploy from a PR](#who-can-deploy-from-a-pr).
- **`release-prepare.yml`** — manual `workflow_dispatch`. Runs `nx release version` + `nx release changelog`, pushes branch `release/vX.Y.Z`, opens a PR titled `chore(release): vX.Y.Z`. The PR is the integration point that lets release coexist with branch protection on `main`.
- **`release-tag.yml`** — runs on every push to `main`. If the head commit subject matches `chore(release): vX.Y.Z` (squash-merge required), it tags the commit and creates a GitHub Release from the matching `CHANGELOG.md` section. The tag is pushed authenticated with `RELEASE_PR_TOKEN` (a PAT) so it triggers `release.yml`'s `push: tags` workflow — pushes authenticated with the default `GITHUB_TOKEN` do not fire downstream triggers.
- **`release.yml`** — triggered by `v*.*.*` tag pushes (from release-tag.yml or a manual `git push origin vX.Y.Z`). Runs deploy-test, then `npx nx release publish` to npm with provenance, authenticated via [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) (OIDC) in the `npm` environment. Trust is configured against this workflow file (`release.yml`), so both the automated chain and the manual escape hatch resolve to the same OIDC `job_workflow_ref` claim.

### Who can deploy from a PR

Auto-deploying every example-touching PR to the shared sandbox account would be both costly and a way to let unvetted code run against AWS, so PR deploys are **restricted by default** and only run when the PR is _cleared for deploy_. The `deploy-test` job in `deploy-test.yml` runs on a PR only when:

1. **Not a fork.** Fork PRs cannot deploy — `pull_request` (never `pull_request_target`) gives them a read-only token with no `id-token: write` and no secrets, and the AWS role's OIDC trust is environment-scoped, so they cannot deploy regardless.
2. **Trusted author _or_ a `safe-to-deploy` label.** A PR authored by someone with write access (`author_association` of `OWNER`, `MEMBER`, or `COLLABORATOR`) deploys automatically. For anyone else, a contributor vouches for the change by adding the **`safe-to-deploy`** label — only users with write access can apply labels, and adding it re-triggers the workflow (the trigger lists the `labeled` activity type).

The nested `ci` job (`uses: ./.github/workflows/ci.yml`) is **skipped on PRs** — `ci.yml` already runs standalone on every PR, so nesting it would double each `CI / *` check as a redundant `Deploy Test / CI / *`. It still runs for non-PR events (`workflow_dispatch`, and the `workflow_call` from `release.yml`), where it is the only pre-deploy CI gate; there `deploy-test` requires it to succeed. On a PR the deploy runs in parallel with the standalone `ci.yml` rather than waiting on it — merge readiness is still gated by `ci.yml` via branch protection.

Two pieces of repo configuration back this:

- **`sandbox` environment deployment-branch policy** must permit the branches PRs are raised from. With a policy restricted to `main` only, every PR-branch deploy is rejected at the environment gate before any step runs (a ~6 s failure with no steps and no logs). Either widen the policy to allow the PR branch namespace or set it to allow all branches; the `if` gate above is what re-imposes the "who can deploy" restriction at the workflow level, and the OIDC `sub` stays pinned to `environment:sandbox`.
- **Branch protection on `main`** is where "a deploy test must pass before merge" is enforced — mark the **Deploy and Verify Examples** check required. Note the interaction with the gate: when a PR is _not_ cleared for deploy, the job is skipped, and GitHub reports a skipped required check as passing. So requiring the check enforces a deploy on cleared PRs but does not, on its own, force every PR to be cleared. To make a deploy mandatory for _all_ example-touching PRs, a contributor must label uncleared PRs (or the gate must be tightened) before merge.

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
   npm run release:dryrun
   ```

   Prints the planned version, changelog, and per-package bumps. Safe any time. The script calls `releaseVersion` then `releaseChangelog` via nx's programmatic API — the same path the CI workflow uses as subcommands. `nx release --dry-run` (the top-level command) is intentionally not used; see the comment in [`scripts/release-dryrun.mjs`](../scripts/release-dryrun.mjs) for the nx@22 config-shape constraint that forces this. `nx.json` sets `commit/tag/push` to `false` under both `release.version.git` and `release.changelog.git`, so a non-dry-run local invocation modifies files but does not commit, tag, or push — `git restore` undoes it.

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

#### `RELEASE_PR_TOKEN` (required)

The automated chain depends on a fine-grained PAT stored as repository secret `RELEASE_PR_TOKEN`. Two reasons:

- **Tag push triggers `release.yml`.** Per [GitHub's rules][gha-token-rules], pushes authenticated with `GITHUB_TOKEN` do not fire downstream workflow triggers. Without the PAT, `release-tag.yml` would tag the commit but `release.yml` would never publish.
- **PR auto-CI.** PRs opened by `GITHUB_TOKEN` do not trigger `pull_request` workflows, so CI would not run on the release PR until someone re-opened it. The PAT-opened PR triggers CI normally.

Create a fine-grained PAT (or GitHub App) scoped to this repo with `contents:write` and `pull_requests:write`, store it as `RELEASE_PR_TOKEN`. Track its expiry — when it lapses, both `release-prepare.yml` and `release-tag.yml` will start failing at the checkout step.

#### Manual fallback

`release.yml` keeps its `push: tags: v*.*.*` trigger as an escape hatch — pushing a `vX.Y.Z` tag manually (typically by an admin with permission to push tags through branch protection) bypasses the automated chain and runs deploy-test → publish directly.

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
   npm trust github @composurecdk/<name> --file release.yml --repo laazyj/composureCDK --env npm --allow-publish
   ```

   `--allow-publish` is required by npm 11.6+ (`npm trust` no longer defaults to a permission). Use `--allow-publish` to match the release flow, which publishes immediately-installable versions; `--allow-stage-publish` would only permit staged publishes that need a separate promotion step.

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

Bootstrap every region the workflow deploys into. Currently:

- The sandbox primary region (whatever `AWS_REGION` is set to on the `sandbox` GitHub environment), and
- `us-east-1`, required by `ComposureCDK-DnsZoneStack` because Route 53 query logging only accepts log groups in that region.

```sh
npx cdk bootstrap aws://ACCOUNT_ID/REGION
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

### 2. Deploy the OIDC stack

`.github/cloudformation/github-oidc-role.yml` creates a GitHub OIDC provider (or references an existing one) and a least-privilege IAM role scoped to `ComposureCDK-*` stacks. The role, managed policy, and OIDC provider are global IAM resources, so this stack only needs to be deployed **once**, regardless of how many regions the workflow targets. The policy's resource ARNs use `*` for the region segment; the security boundary is the `ComposureCDK-` tag-condition / stack-name pattern, not the region.

```sh
aws cloudformation deploy \
  --template-file .github/cloudformation/github-oidc-role.yml \
  --stack-name github-actions-oidc \
  --parameter-overrides GitHubOrg=laazyj RepoName=composureCDK \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation update-termination-protection \
  --stack-name github-actions-oidc \
  --enable-termination-protection
```

Termination protection is enabled separately (CFN templates cannot self-protect). Without it, an accidental `delete-stack` on this stack would tear down the role mid-deploy and break every workflow run. Re-runs of `aws cloudformation deploy` are unaffected — termination protection only blocks deletion.

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

Add protection rules (e.g. required reviewers) as desired. **Deployment branch policy:** if you restrict which branches may deploy, the policy must include the branches PRs are raised from, or the auto-on-PR `deploy-test` run is rejected at the environment gate before any step runs. See [Who can deploy from a PR](#who-can-deploy-from-a-pr).

### 4. Trigger the workflow

**Actions → Deploy Test → Run workflow**, select `sandbox`.

## Running locally

```sh
npm run verify         # all CI checks in one go
npm run format:check   # or run individually
npm run typecheck
npm run build
npm run check:exports
npm run lint
npm run test
```

`npm run verify` chains the exact targets `ci.yml` runs, so a green `verify`
locally means a green CI. A husky `pre-push` hook runs `npm run verify`
automatically — a regression cannot reach GitHub without the maintainer seeing
it first. The only check `verify` cannot reproduce is CI's Node 20 + 24 matrix.

`check:exports` runs `attw` + `publint` per package against the built `dist/`,
catching broken or masquerading `exports` maps and dual-package issues. The
`@composurecdk/module-compat` package (run by `npm run test`) spawns `node` to
load every package under both `require()` and `import`, and synthesizes a CDK
app under each module system. Together they enforce the dual-publish standard
([ADR-0007](adr/0007-dual-esm-cjs-publishing.md)).

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
- **PR deploys are gated** — `deploy-test.yml` auto-runs on PRs touching `packages/examples/**`, but only deploys when the PR is cleared (trusted author or `safe-to-deploy` label, never a fork). Fork PRs are structurally unable to deploy regardless: they trigger on `pull_request` (never `pull_request_target`), so GitHub issues a read-only token with no `id-token: write` and no secrets, and the OIDC `sub` is pinned to `repo:<org>/<repo>:environment:sandbox` so STS would reject a fork's token. The `if` guard on both jobs is defence in depth plus runner thrift. Do not switch this trigger to `pull_request_target` or broaden the role's `sub` condition. See [Who can deploy from a PR](#who-can-deploy-from-a-pr).
- **Tag-based resource scoping** — Lambda, CloudWatch Logs, and IAM permissions use `aws:cloudformation:stack-name` tag conditions limited to `ComposureCDK-*`. The Neptune smoke test's `ssm:SendCommand` is likewise scoped to bastion instances carrying that tag (the `AWS-RunShellScript` document is granted separately). SQS smoke-test access is ARN-scoped to the sandbox account (CloudFormation system tags don't propagate to SQS in a form IAM evaluates). Read-only describes that AWS does not support resource-level permissions for — EC2 `Describe*`, `rds:DescribeDBClusters`, `ssm:GetCommandInvocation`, `cloudformation:ListStacks` — are granted on `*`.
- **npm provenance** — published packages include provenance attestations linking them to this repo and workflow run.
- **Action pinning** — all GitHub Actions are pinned by commit SHA, kept current by Dependabot.
- **Concurrency** — deploy-test uses `cancel-in-progress: false` so an in-flight deployment cannot be interrupted into an inconsistent state.
