# Continuous Integration

CI/CD pipeline for ComposureCDK: how the workflows chain, how to bootstrap AWS and npm access, and how to cut a release.

## Pipeline overview

Each arrow below means "causes the thing under it"; the text beside it is the trigger that carries it. `coverage-comment.yml` and `release-notify.yml` hang off CI and Release as `workflow_run` listeners rather than links in the chain.

```
Every PR, and every push to main
  ci.yml ──workflow_run──► coverage-comment.yml   (sticky coverage comment)

Cutting a release
  release-prepare.yml            workflow_dispatch, by hand
    │ pushes release/vX.Y.Z with the PAT, opens the release PR
    ▼
  deploy-test.yml                push: release/**    ◄── the release gate,
    │ uses: ci.yml, then deploys and smoke-tests         a check on the PR
    │ workflow_run, pass or fail
    ▼
  sandbox-cleanup.yml            (also a nightly cron safety net)

    ··········· squash-merge the release PR ···········

  release-tag.yml                push: main, chore(release): vX.Y.Z commits
    │ pushes tag vX.Y.Z with the PAT
    ▼
  release.yml                    push: tags v*.*.* — GitHub Release, then npm
    │ workflow_run
    ▼
  release-notify.yml             (comments on the issues the release addressed)
```

`deploy-test.yml` also runs standalone via `workflow_dispatch`.

- **`ci.yml`** — runs format/typecheck/build/`check:exports`/lint/test on a Node 20/22/24/26 matrix, on every push and PR. Also `workflow_call`-able. Quality gate for everything downstream. The steps are just `npm run` scripts — the same ones `npm run verify` chains locally — so CI executes the gate, it does not _define_ it (see [ADR-0007](adr/0007-dual-esm-cjs-publishing.md)). The Node 24 leg also reports test coverage on PRs (see [Coverage reporting](#coverage-reporting)). It holds no write scopes, so it stays callable from `deploy-test.yml`.
- **`coverage-comment.yml`** — `workflow_run` listener on CI. Posts the coverage table as a sticky PR comment (see [Coverage reporting](#coverage-reporting)).
- **`deploy-test.yml`** — calls CI as a pre-deploy sanity check (Node 24 only, no floor shards — see [Trimming CI for deploy-test](#trimming-ci-for-deploy-test)), then deploys all example stacks to the `sandbox` environment via OIDC, runs `scripts/smoke-test.mjs`, and exits. Teardown runs separately in `sandbox-cleanup.yml` so developer feedback lands in ~10 min instead of waiting on CloudFront propagation. Runs on demand via `workflow_dispatch`, and automatically on any push to `release/**` — **that is the release gate**, and it lands as a check on the release PR next to CI. A release branch is the only ref holding exactly what is being released, version bumps and changelog included; `main`'s HEAD is a different tree, and tag time is too late to gate anything.
- **`release-prepare.yml`** — manual `workflow_dispatch`. Runs `nx release version` + `nx release changelog`, pushes branch `release/vX.Y.Z`, opens a PR titled `chore(release): vX.Y.Z`. The PR is the integration point that lets release coexist with branch protection on `main`; pushing the branch is also what starts the deploy gate above.
- **`release-tag.yml`** — runs on every push to `main`. If the head commit subject matches `chore(release): vX.Y.Z` (squash-merge required), it tags the commit. The tag is pushed authenticated with `RELEASE_PR_TOKEN` (a PAT) so it triggers `release.yml`'s `push: tags` workflow — pushes authenticated with the default `GITHUB_TOKEN` do not fire downstream triggers.
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

- **Why two workflows.** `ci.yml` is `workflow_call`-able from `deploy-test.yml`, and GitHub only ever _narrows_ permissions down a reusable-workflow chain. A job inside `ci.yml` declaring `pull-requests: write` therefore fails validation for any caller that lacks that scope — statically, at parse time, regardless of whether the posting step's `if:` would ever let it run. Keeping `ci.yml` at `contents: read` makes it callable from anywhere; the write scope lives only in `coverage-comment.yml`.
- **Fork PRs** now get a comment too. `workflow_run` executes in the base-repo context with a writable `GITHUB_TOKEN`, which the old in-line comment step could not obtain. The listener never checks out or executes PR code — it only reads the uploaded markdown and the PR number, which it validates is numeric before use.
- `coverage-comment.yml` must exist on the **default branch** to fire; `workflow_run` always dispatches the default-branch copy. Changes to it are not exercised by the PR that introduces them.
- The summary and upload steps run with `if: always()`, so when a package dips below its threshold and fails `npm run test`, reviewers still see the table (with the offending package flagged). The job status still reflects the failure — the gate is unchanged. Because they now share a job with the earlier gates, they additionally guard on `steps.test.conclusion != 'skipped'`: a typecheck or lint failure skips `Test`, leaving no `coverage-summary.json` to merge, and the reporting steps should stay quiet rather than fail a second time on the same root cause.
- **A missing artifact is a normal outcome, not a failure of the listener.** A cancelled CI run (push-over-push) or one that fails an earlier gate in the Node 24 leg uploads nothing, so `coverage-comment.yml` tolerates the download (`continue-on-error`) and gates its posting steps on that step's `outcome`: no artifact, no comment, run stays green. Hard-failing there would report the same root cause a second time, as a separate red run alongside the CI failure that caused it. The listener is deliberately **not** gated on `workflow_run.conclusion == 'success'` — a coverage threshold miss fails `Test` but still uploads the table, and that is exactly the run whose comment reviewers want.

## Linting the workflows

`npm run actionlint` runs [actionlint](https://github.com/rhysd/actionlint) over `.github/workflows/`. It is chained into `npm run verify` (so the husky `pre-push` hook catches it), fires from `lint-staged` in `pre-commit` whenever a workflow file is staged, and runs in CI as the **Lint workflows** step. Same npm script in all three places — CI executes the gate, it does not define it.

Workflow files are the case that most needs a local gate, because CI is least able to check them: a `workflow_run` listener always dispatches the _default-branch_ copy, and an edit to a trigger is not exercised until it next fires. `actionlint` is often the only pre-merge signal a workflow change gets.

Four things make this reliable rather than decorative:

- **actionlint is a pinned devDependency** — `github-actionlint`, which fetches the official release binary for the version it is named after. [`scripts/actionlint.mjs`](../scripts/actionlint.mjs) resolves it from the installed package rather than from `PATH`.
- **A missing shellcheck fails the run.** actionlint treats shellcheck as optional: it shells out only if it finds it and reports a clean run when it does not — and it does the same for an explicit `-shellcheck=` path that resolves to nothing. Both exit `0` with no output. That matters more than it sounds, because _every finding this repo has ever had came from shellcheck rather than actionlint's own checks_, so a missing shellcheck does not weaken the gate, it empties it. The script therefore probes shellcheck first and refuses to lint until it has proven it runs.
- **The CI step cannot silently vanish.** It runs on one matrix leg, selected as `fromJSON(...)[0]` rather than a literal `== 24`. The first entry always exists, so the gate follows the matrix; pinning it to a version number would drop the check the moment that version rotated out — the same silent-skip class the script guards against internally.
- **A missing shellcheck is a red build, not a skipped one.** CI relies on the GitHub-hosted `ubuntu-latest` image shipping shellcheck; nothing installs it. If that image ever drops it, the probe above exits non-zero and **Lint workflows** fails on every PR with the install hint — loudly, which is the point. That is why there is no `apt-get` step buying a network dependency to pre-empt a failure that already describes itself.

shellcheck comes from `PATH` rather than npm because the packages that vendored its binary cost ~97 transitive dependencies — including the abandoned `decompress`, which has no fixed release for [GHSA-mp2f-45pm-3cg9](https://github.com/advisories/GHSA-mp2f-45pm-3cg9) — and pinned nothing in return: they resolved the _latest_ shellcheck at install time, so two clones a month apart already disagreed. The script enforces a **minimum of 0.9.0** instead, and names the version it found when it rejects one. Contributors need `shellcheck >= 0.9` on `PATH`; note that Debian bullseye and Ubuntu 20.04 still package 0.7.x.

The whole run takes ~300ms, so it is simply always run rather than cached or path-filtered: nx's own overhead on a cache _hit_ exceeds the cost of doing the work, and a path filter is one more thing to drift. It is a plain `node scripts/*.mjs` npm script like `catalogue:check` and `cdk-floors:check`.

Suppress a false positive with a `# shellcheck disable=SCxxxx` comment inside the `run:` block, and say why — as `ci.yml`'s `Read distinct floors from manifest` step does, where single quotes are load-bearing and "fixing" SC2016 would break the script.

## Trimming CI for deploy-test

`ci.yml` takes two `workflow_call` inputs, both defaulting to the full run so `push` and `pull_request` are untouched — those events carry no inputs, and the expressions fall back accordingly:

| Input             | Default              | Effect                                           |
| ----------------- | -------------------- | ------------------------------------------------ |
| `node-versions`   | `"[20, 22, 24, 26]"` | JSON array driving the matrix                    |
| `skip-cdk-floors` | `false`              | Skips `cdk-floors-list` and its `enforce` shards |

`deploy-test.yml` passes `"[24]"` and `true`, taking that call from 17 jobs to 1.

The trimmed-away work cannot tell you whether the examples deploy. The Node 20/22/26 legs exist to prove dual ESM/CJS resolution across runtimes ([ADR-0007](adr/0007-dual-esm-cjs-publishing.md)); the floor shards pin `aws-cdk-lib` down to each package's declared minimum ([ADR-0008](adr/0008-aws-cdk-lib-version-floors.md)). A deploy runs on Node 24 against the installed `aws-cdk-lib` and touches neither dimension. What is kept is the whole `verify` chain on Node 24 — format, actionlint, typecheck, build, `check:exports`, lint, `cdk-floors:check`, `validate` (synth + CloudFormation Validate), test — which is the part that can.

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

   Pushing the `release/vX.Y.Z` branch fires `deploy-test.yml`, so the sandbox deploy starts on its own as soon as the PR exists — allow ~45 min for it alongside CI. The two overlap: the PR's own CI run covers the merge ref, and `deploy-test.yml` calls CI again for the branch tip. On a freshly cut release branch those are the same tree, so expect the trimmed Node 24 leg (see [Trimming CI for deploy-test](#trimming-ci-for-deploy-test)) to run twice per release.

3. **Review and merge.** Squash-merge once **both** CI and **Deploy Test** are green on the PR. (The release-tag filter assumes the release commit is HEAD on `main`.) Deploy Test ran against the release branch — the exact tree being released — so nothing downstream re-runs it. Pushing a fix to the branch re-runs both checks.

   The merge checklist is the enforcement here, not branch protection: required status checks are configured per _base_ branch, so requiring Deploy Test on `main` would block every PR — the check only ever runs on `release/**`.

4. **Tag and publish — automatic.** `release-tag.yml` tags the merge commit, and the tag invokes `release.yml`, which creates the GitHub Release and publishes to npm. Neither re-runs the deploy: merging the release PR _is_ the release decision.

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

The automated chain depends on a fine-grained PAT stored as repository secret `RELEASE_PR_TOKEN`. Three reasons, all the same underlying rule — per [GitHub's rules][gha-token-rules], anything authenticated with `GITHUB_TOKEN` does not fire downstream workflow triggers:

- **Tag push triggers `release.yml`.** Without the PAT, `release-tag.yml` would tag the commit but `release.yml` would never publish.
- **Release-branch push triggers `deploy-test.yml`.** Without the PAT, the release gate would silently never run — the PR would simply have no Deploy Test check.
- **PR auto-CI.** PRs opened by `GITHUB_TOKEN` do not trigger `pull_request` workflows, so CI would not run on the release PR until someone re-opened it. The PAT-opened PR triggers CI normally.

Create a fine-grained PAT (or GitHub App) scoped to this repo with `contents:write` and `pull_requests:write`, store it as `RELEASE_PR_TOKEN`. Track its expiry — when it lapses, both `release-prepare.yml` and `release-tag.yml` will start failing at the checkout step.

#### Manual fallback

`release.yml` keeps its `push: tags: v*.*.*` trigger as an escape hatch — pushing a `vX.Y.Z` tag manually (typically by an admin with permission to push tags through branch protection) bypasses the automated chain and goes straight to Release + publish. deploy-test gates the release branch, not the tag or the publish, so a hand-pushed tag skips it entirely: run **Deploy Test** via `workflow_dispatch` first if you take this route.

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

Then restrict **which refs may deploy to it**. This is the control that actually holds the AWS credentials: the trust policy in `github-oidc-role.yml` scopes assumption to `repo:<org>/<repo>:environment:sandbox`, so any workflow that reaches the `sandbox` environment can assume the role. Set the environment's deployment branches to _selected branches and tags_ and allow exactly:

| Pattern     | Type   | Why                                               |
| ----------- | ------ | ------------------------------------------------- |
| `main`      | branch | Manual **Deploy Test** dispatch                   |
| `release/*` | branch | The release gate, on every release-branch push    |
| `v*.*.*`    | tag    | Kept for a hand-pushed tag on the manual fallback |

A wildcard like `*/*` would let any contributor push `anything/x` and obtain sandbox credentials. The flip side of the narrow list: **Deploy Test** can no longer be dispatched from a feature branch — merge to `main` or use a `release/` branch.

Add protection rules (e.g. required reviewers) as desired.

### 3a. Restrict release branches

Because a push to `release/**` now deploys by itself, pair the environment policy with a repository ruleset so contributors cannot create such a branch in the first place:

| Setting | Value                                                    |
| ------- | -------------------------------------------------------- |
| Target  | `refs/heads/release/**`                                  |
| Rules   | Restrict creations, restrict updates, restrict deletions |
| Bypass  | Repository admin                                         |

`release-prepare.yml` pushes with `RELEASE_PR_TOKEN`, which acts as its owner — so that owner must hold the bypass, or the workflow fails at the branch push. The two controls are complementary: the ruleset governs who can make a release branch, the environment policy governs what a release branch can reach.

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
- **Tag-based resource scoping** — Lambda, CloudWatch Logs, and IAM permissions use `aws:cloudformation:stack-name` tag conditions limited to `ComposureCDK-*`. The Neptune smoke test's `ssm:SendCommand` is likewise scoped to bastion instances carrying that tag (the `AWS-RunShellScript` document is granted separately). SQS, SNS, and DynamoDB smoke-test access is ARN-scoped to the sandbox account (CloudFormation system tags don't propagate to SQS or SNS in a form IAM evaluates, and DynamoDB does not support tag-based authorization for data-plane actions at all). Read-only describes that AWS does not support resource-level permissions for — EC2 `Describe*`, `rds:DescribeDBClusters`, `ssm:GetCommandInvocation`, `cloudformation:ListStacks` — are granted on `*`.
- **npm provenance** — published packages include provenance attestations linking them to this repo and workflow run.
- **Action pinning** — all GitHub Actions are pinned by commit SHA, kept current by Dependabot.
- **Concurrency** — deploy-test uses `cancel-in-progress: false` so an in-flight deployment cannot be interrupted into an inconsistent state.
