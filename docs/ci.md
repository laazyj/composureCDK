# Continuous Integration

CI/CD pipeline for ComposureCDK: how the workflows chain, how to bootstrap AWS and npm access, and how to cut a release.

## Pipeline overview

Five GitHub Actions workflows chain together, with `coverage-comment.yml` and `release-notify.yml` hanging off CI and Release as listeners rather than links in the chain:

```
ci.yml ──► deploy-test.yml ──► release-tag.yml ──► release.yml
   ▲              ▲                   ▲                 ▲
   │              │                   │                 │
 PRs/push  workflow_dispatch    push to main       tag push (PAT
   │                            (chore(release):    or manual)
   │ workflow_run                vX.Y.Z commits)
   ▼                                  ▲
coverage-comment.yml                  │
                              release-prepare.yml (workflow_dispatch → opens PR)
```

- **`ci.yml`** — runs format/typecheck/build/`check:exports`/lint/test on a Node 20/22/24/26 matrix, on every push and PR. Also `workflow_call`-able. Quality gate for everything downstream. The steps are just `npm run` scripts — the same ones `npm run verify` chains locally — so CI executes the gate, it does not _define_ it (see [ADR-0007](adr/0007-dual-esm-cjs-publishing.md)). The Node 24 leg also reports test coverage on PRs (see [Coverage reporting](#coverage-reporting)). It holds no write scopes, so it stays callable from `deploy-test.yml`.
- **`coverage-comment.yml`** — `workflow_run` listener on CI. Posts the coverage table as a sticky PR comment (see [Coverage reporting](#coverage-reporting)).
- **`deploy-test.yml`** — manual `workflow_dispatch`, and called by `release-tag.yml`. Calls CI as a pre-deploy sanity check (Node 24 only, no floor shards — see [Trimming CI for deploy-test](#trimming-ci-for-deploy-test)), then deploys all example stacks to the `sandbox` environment via OIDC, runs `scripts/smoke-test.mjs`, and exits. Teardown runs separately in `sandbox-cleanup.yml` so developer feedback lands in ~10 min instead of waiting on CloudFront propagation.
- **`release-prepare.yml`** — manual `workflow_dispatch`. Runs `nx release version` + `nx release changelog`, pushes branch `release/vX.Y.Z`, opens a PR titled `chore(release): vX.Y.Z`. The PR is the integration point that lets release coexist with branch protection on `main`.
- **`release-tag.yml`** — runs on every push to `main`. If the head commit subject matches `chore(release): vX.Y.Z` (squash-merge required), it runs deploy-test and then tags the commit. The tag is the release gate: it is only created once the example fleet has deployed and smoke-tested cleanly, so a bad release never leaves a dangling tag to clean up. It is pushed authenticated with `RELEASE_PR_TOKEN` (a PAT) so it triggers `release.yml`'s `push: tags` workflow — pushes authenticated with the default `GITHUB_TOKEN` do not fire downstream triggers.
- **`release.yml`** — triggered by `v*.*.*` tag pushes (from release-tag.yml or a manual `git push origin vX.Y.Z`). Creates the GitHub Release from the matching `CHANGELOG.md` section, then runs `npx nx release publish` to npm with provenance, authenticated via [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) (OIDC) in the `npm` environment. Trust is configured against this workflow file (`release.yml`), so both the automated chain and the manual escape hatch resolve to the same OIDC `job_workflow_ref` claim.
- **`release-notify.yml`** — `workflow_run` listener on Release. Comments on the issues the release addressed (see [Release notifications](#release-notifications)).

## Coverage reporting

Coverage is reported on PRs without any external service (no Codecov/Coveralls account, no secrets, no data leaving GitHub). It is a reporting layer only — the actual gate is each package's `perFile` thresholds in `vitest.config.ts`, enforced by `npm run test`.

How it fits together:

- **`vitest.config.base.ts`** emits the `json-summary` reporter alongside `text`, so every `npm run test` writes `packages/<pkg>/coverage/coverage-summary.json`. `nx.json` lists `{projectRoot}/coverage` in the `test` target's `outputs`, so a cached test run still restores the summary files.
- **[`scripts/coverage-summary.mjs`](../scripts/coverage-summary.mjs)** (`npm run coverage:summary`) merges every package's summary into one markdown table — per-package and an overall total computed as summed-covered / summed-total, not an average of percentages. It writes `coverage/coverage-summary.md`, prints to stdout, and appends to `$GITHUB_STEP_SUMMARY` when set.
- **The Node 24 leg of `ci.yml`'s matrix** builds the summary after its `Test` step (so it lands on the Actions run page), and — on `pull_request` events — uploads `coverage-summary.md` plus the PR number as a `coverage-summary` artifact. These are steps on the matrix job, not a job of their own: a sibling job had to repeat the whole build → typecheck → test chain the Node 24 leg already runs, duplicating ~3.5 min of wall-clock per CI run for byte-identical output.
- **[`coverage-comment.yml`](../.github/workflows/coverage-comment.yml)** listens for CI's `workflow_run` completion, downloads that artifact, and posts it as a sticky PR comment via `marocchino/sticky-pull-request-comment` (keyed `header: coverage`, so it updates in place instead of adding a comment per push).

Notes:

- **Why two workflows.** `ci.yml` is `workflow_call`-able from `deploy-test.yml` (which `release-tag.yml` calls in turn), and GitHub only ever _narrows_ permissions down a reusable-workflow chain. A job inside `ci.yml` declaring `pull-requests: write` therefore fails validation for any caller that lacks that scope — statically, at parse time, regardless of whether the posting step's `if:` would ever let it run. Keeping `ci.yml` at `contents: read` makes it callable from anywhere; the write scope lives only in `coverage-comment.yml`.
- **Fork PRs** now get a comment too. `workflow_run` executes in the base-repo context with a writable `GITHUB_TOKEN`, which the old in-line comment step could not obtain. The listener never checks out or executes PR code — it only reads the uploaded markdown and the PR number, which it validates is numeric before use.
- `coverage-comment.yml` must exist on the **default branch** to fire; `workflow_run` always dispatches the default-branch copy. Changes to it are not exercised by the PR that introduces them.
- The summary and upload steps run with `if: always()`, so when a package dips below its threshold and fails `npm run test`, reviewers still see the table (with the offending package flagged). The job status still reflects the failure — the gate is unchanged. Because they now share a job with the earlier gates, they additionally guard on `steps.test.conclusion != 'skipped'`: a typecheck or lint failure skips `Test`, leaving no `coverage-summary.json` to merge, and the reporting steps should stay quiet rather than fail a second time on the same root cause.
- **A missing artifact is a normal outcome, not a failure of the listener.** A cancelled CI run (push-over-push) or one that fails an earlier gate in the Node 24 leg uploads nothing, so `coverage-comment.yml` tolerates the download (`continue-on-error`) and gates its posting steps on that step's `outcome`: no artifact, no comment, run stays green. Hard-failing there would report the same root cause a second time, as a separate red run alongside the CI failure that caused it. The listener is deliberately **not** gated on `workflow_run.conclusion == 'success'` — a coverage threshold miss fails `Test` but still uploads the table, and that is exactly the run whose comment reviewers want.

## Trimming CI for deploy-test

`ci.yml` takes two `workflow_call` inputs, both defaulting to the full run so `push` and `pull_request` are untouched — those events carry no inputs, and the expressions fall back accordingly:

| Input             | Default              | Effect                                           |
| ----------------- | -------------------- | ------------------------------------------------ |
| `node-versions`   | `"[20, 22, 24, 26]"` | JSON array driving the matrix                    |
| `skip-cdk-floors` | `false`              | Skips `cdk-floors-list` and its `enforce` shards |

`deploy-test.yml` passes `"[24]"` and `true`, taking that call from 17 jobs to 1.

The trimmed-away work cannot tell you whether the examples deploy. The Node 20/22/26 legs exist to prove dual ESM/CJS resolution across runtimes ([ADR-0007](adr/0007-dual-esm-cjs-publishing.md)); the floor shards pin `aws-cdk-lib` down to each package's declared minimum ([ADR-0008](adr/0008-aws-cdk-lib-version-floors.md)). A deploy runs on Node 24 against the installed `aws-cdk-lib` and touches neither dimension. What is kept is the whole `verify` chain on Node 24 — format, typecheck, build, `check:exports`, lint, `cdk-floors:check`, `validate` (synth + CloudFormation Validate), test — which is the part that can.

`skip-cdk-floors` is phrased as a skip rather than a run because an unset input coerces to `false` in GitHub expressions, so `false` has to be the value that means "do the normal thing".

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

4. **Deploy-test, tag, publish — automatic.** `release-tag.yml` deploys the examples to the sandbox and only tags the commit if that passes (allow ~40 min); the tag then invokes `release.yml`, which creates the GitHub Release and publishes to npm. A deploy failure leaves `main` untagged — fix forward and re-run the workflow on the same commit.

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

`release.yml` keeps its `push: tags: v*.*.*` trigger as an escape hatch — pushing a `vX.Y.Z` tag manually (typically by an admin with permission to push tags through branch protection) bypasses the automated chain and goes straight to Release + publish. deploy-test gates the tag, not the publish, so a hand-pushed tag skips it entirely: run **Deploy Test** via `workflow_dispatch` first if you take this route.

[gha-token-rules]: https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow

### Release notifications

[`release-notify.yml`](../.github/workflows/release-notify.yml) listens for a successful Release run and posts one comment per issue that release addressed:

> Addressed in **v0.9.1** — see the [release notes](https://github.com/laazyj/composureCDK/releases/tag/v0.9.1).
>
> Published to npm as `@composurecdk/*@0.9.1`.

Which issues those are is worked out by [`scripts/release-issue-comments.mjs`](../scripts/release-issue-comments.mjs) (`npm run release:issue-comments`) from the published release body — see its header for the discovery rules and why the release body, rather than `CHANGELOG.md`, is the source. Every comment carries a hidden `<!-- composurecdk-release: vX.Y.Z -->` marker, so nothing is ever posted twice; issues are commented on whatever their state, since a closed one is exactly the case worth announcing.

Notes:

- **Re-running is safe and is the fix for a partial failure.** The script exits non-zero if any comment fails to post, and the release is already out by then. Re-run the workflow, or trigger it by hand: **Actions → Release Notify → Run workflow**, with the tag (e.g. `v0.9.1`).
- Preview against any past release without posting:

  ```sh
  node scripts/release-issue-comments.mjs --tag=v0.9.1 --repo=laazyj/composureCDK --dry-run
  ```

- Like `coverage-comment.yml`, this workflow must exist on the **default branch** to fire — `workflow_run` always dispatches the default-branch copy, so changes to it are not exercised by the PR that introduces them.

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

Add protection rules (e.g. required reviewers) as desired.

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

`npm run lint` is `nx run-many -t lint` — a cached nx target like build and
test, so re-running it after an unrelated change fast-succeeds from cache
instead of re-linting the whole tree. Every package is linted in place, and
loose top-level files are linted by the `workspace-root` project (see
[AGENTS.md](../AGENTS.md#build-system)).

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
- **Tag-based resource scoping** — Lambda, CloudWatch Logs, and IAM permissions use `aws:cloudformation:stack-name` tag conditions limited to `ComposureCDK-*`. The Neptune smoke test's `ssm:SendCommand` is likewise scoped to bastion instances carrying that tag (the `AWS-RunShellScript` document is granted separately). SQS and DynamoDB smoke-test access is ARN-scoped to the sandbox account (CloudFormation system tags don't propagate to SQS in a form IAM evaluates, and DynamoDB does not support tag-based authorization for data-plane actions at all); the order-processor smoke test's `sns:Publish` is ARN-scoped to `ComposureCDK-*` topics, which works because CloudFormation prefixes generated topic names with the stack name. Read-only describes that AWS does not support resource-level permissions for — EC2 `Describe*`, `rds:DescribeDBClusters`, `ssm:GetCommandInvocation`, `cloudformation:ListStacks` — are granted on `*`.
- **npm provenance** — published packages include provenance attestations linking them to this repo and workflow run.
- **Action pinning** — all GitHub Actions are pinned by commit SHA, kept current by Dependabot.
- **Concurrency** — deploy-test uses `cancel-in-progress: false` so an in-flight deployment cannot be interrupted into an inconsistent state.
