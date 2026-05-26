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

`scripts/cdk-floors.mjs` provides the modes (npm scripts `cdk-floors:*`):

- **`apply`** — writes each package's `peerDependencies.aws-cdk-lib` from the
  manifest.
- **`check`** — asserts package.json ranges match the manifest. Cheap; runs in
  the main CI job and `verify`.
- **`enforce`** — loads each package against a real install of its own
  declared floor and fails if any doesn't. The "don't breach the floor" PR
  gate, in its own CI job (network installs per floor).
- **`establish`** _(follow-up tool)_ — packs the graph and loads every
  package against a descending ladder of real aws-cdk-lib releases, recording
  the lowest each loads on and the gating export. Writes a ladder-granular
  draft to be refined into `cdk-floors.json`. Re-run it to **prove a new,
  lower floor** when deliberately grandfathering older support.

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
- The ranges become regression-proof in two layers: `check` stops package.json
  drifting from the manifest, and `enforce` stops a package quietly requiring
  a newer CDK than its declared floor.
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
