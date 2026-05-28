# ADR 0008: Per-package aws-cdk-lib version floors

- **Status:** Accepted
- **Date:** 2026-05-26

## Context

Every publishable `@composurecdk/*` package declared `peerDependencies.aws-cdk-lib`
as `^2.0.0`. That was an untested claim: the packages were only ever built and
tested against the latest CDK. Issue #146 made the gap concrete — the CloudWatch
alarm policies called `CfnAlarm.isCfnAlarm`, a static introduced in aws-cdk-lib
2.231.0, so every consumer on 2.0.0–2.230.x hit a `TypeError` at synth despite
the `^2.0.0` promise.

Measuring real installs showed the packages have **widely different** actual
floors, because each pulls different named exports from aws-cdk-lib:

| floor   | packages                                         | gated by                                              |
| ------- | ------------------------------------------------ | ----------------------------------------------------- |
| 2.0.0   | cloudformation                                   | imports only the aws-cdk-lib root entry               |
| 2.1.0   | cloudwatch, sns, sqs, iam, logs, events, budgets | aws-cdk-lib ESM subpath exports (`aws-cdk-lib/aws-*`) |
| 2.54.0  | apigateway, ec2, s3                              | `aws-cloudwatch.Stats`                                |
| 2.118.0 | cloudfront                                       | `aws-cloudfront.FunctionRuntime`                      |
| 2.119.0 | acm                                              | `aws-certificatemanager.KeyAlgorithm`                 |
| 2.168.0 | lambda                                           | `aws-lambda.MetricType`                               |
| 2.216.0 | route53                                          | `aws-route53.HttpsRecord`                             |

(`core` depends on `constructs` only, not aws-cdk-lib, so it has no floor.)

A single library-wide floor would force every consumer up to route53's 2.216.0,
penalising the many packages that work far lower. The packages are published and
consumed independently, so the floor belongs per package.

## Decision

**Each publishable package declares its own measured `peerDependencies.aws-cdk-lib`
floor. `cdk-floors.json` is the source of truth; tooling establishes, applies,
and enforces it.** Floors are monotonic with the peer graph — a package's floor
is the max of its own aws-cdk-lib usage and its `@composurecdk` peers' floors,
which holds automatically because a package can only load once its peers do.

### What a floor guarantees

A floor guarantees the builders **do not hard-fail** (throw at synth, or fail to
import a missing export) on that aws-cdk-lib version. It does **not** promise that
every convenience renders identically all the way down.

The distinction matters for **tag propagation**. Builder `.tag()`/`.tags()` reach
a construct via the CDK Tags aspect, which can only write tags onto an L1 that AWS
has made taggable. Several L1s gained tag support well after they first shipped —
e.g. `AWS::CloudWatch::Alarm` only became taggable in aws-cdk-lib **2.138.0** and
`AWS::CloudFront::Function` in **2.251.0**. Below those versions, builder tags on
those resources are **silently dropped** — the template synthesises correctly,
the tags just do not appear. This is benign graceful degradation, not a crash, so
it does **not** gate the floor: pinning `cloudwatch`/`s3` at the alarm-tagging
version (or `cloudfront` at 2.251.0) purely to render tags would needlessly punish
the far more common case of a consumer who tags nothing. Consumers who need tags on
those resources must run an aws-cdk-lib new enough to support tagging them.

The unit suites encode this: tag-propagation tests probe (by synthesis) whether the
installed CDK tags the resource and assert tags-present-or-gracefully-absent
accordingly, so `enforce` stays green at the floor without weakening the assertion
at the latest CDK.

`scripts/cdk-floors.mjs` provides four modes (npm scripts `cdk-floors:*`),
landing across a small sequence of PRs:

- **`apply`** — writes each package's `peerDependencies.aws-cdk-lib` from the
  manifest. _(This PR.)_
- **`check`** — asserts package.json ranges match the manifest. Cheap; runs in
  the main CI job and `verify`. _(This PR.)_
- **`enforce`** — loads each package against a real install of its own declared
  floor and fails if any doesn't. The "don't breach the floor" PR gate.
  _(Follow-up PR.)_
- **`establish`** — packs the graph and loads every package against a
  descending ladder of real aws-cdk-lib releases, recording the lowest each
  loads on and the gating export. Writes a ladder-granular draft
  (`cdk-floors.discovered.json`) to be refined into `cdk-floors.json`. Re-run
  it to **prove a new, lower floor** when deliberately grandfathering older
  support. _(Follow-up PR — discovery / floor-research tool.)_

Floor values are measured at the **import-time** boundary (named exports a
package pulls from aws-cdk-lib), where every constraint observed so far lives.
The per-package unit suites — run on every commit against the latest CDK —
catch runtime regressions in the supported range. A separate on-demand
diagnostic synth tool exists for ad-hoc validation at any chosen aws-cdk-lib
version (bug repro, candidate-floor validation, release prep); it is not a PR
gate, because no single fixed CDK version is the right one to test against
continuously.

This complements the static guard already in place: the
`composurecdk/no-cdk-api-above-floor` ESLint rule (`@composurecdk/eslint-plugin`)
blocks known version-gated APIs at lint time, so they can't be written into
`src/` in the first place.

## Consequences

- Consumers get honest, per-package ranges; low-floor packages stay broadly
  installable.
- The ranges become regression-proof in two layers: `check` (this PR) stops
  package.json drifting from the manifest, and `enforce` (follow-up PR) stops
  a package quietly requiring a newer CDK than its declared floor.
- Lowering a floor is a deliberate, evidenced act: remove the requiring API,
  re-run `establish` against the candidate floor, validate the composed synth
  against it, refine the manifest, `apply`.
- The import probe is a lower bound; a runtime-only requirement could push a
  floor above the measured value. The per-package unit suites at latest CDK
  catch new regressions; the diagnostic synth tool validates candidate floors
  before they're applied.
- Floors are pinned to the exact introducing release. They will rise over time
  as packages adopt newer CDK features — that is expected and intentional, and
  the tooling makes each change measured rather than assumed.
