# ADR 0008: Per-package aws-cdk-lib version floors

- **Status:** Accepted
- **Date:** 2026-05-25

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

`scripts/cdk-floors.mjs` provides four modes (npm scripts `cdk-floors:*`):

- **`establish`** — packs the graph and loads every package against a descending
  ladder of real aws-cdk-lib releases, recording the lowest each loads on and
  the gating export. Writes a ladder-granular draft (`cdk-floors.discovered.json`)
  to be refined into `cdk-floors.json`. Re-run it (optionally with a denser
  `CDK_FLOOR_LADDER`) to **prove a new, lower floor** when deliberately
  grandfathering older support.
- **`apply`** — writes each package's `peerDependencies.aws-cdk-lib` from the
  manifest.
- **`check`** — asserts package.json ranges match the manifest. Cheap; runs in
  the main CI job and `verify`.
- **`enforce`** — loads each package against a real install of its own declared
  floor and fails if any doesn't. This is the "don't breach the floor" guard;
  it runs in the `cdk-floor` CI job.

Establishment measures the **import-time** floor (named exports), where every
constraint observed so far lives. The composed-synth harness (`test:cdk-floor`)
and the per-package suites additionally exercise runtime behaviour; a
runtime-only gap would surface there and raise the floor.

This complements the existing guards: the `composurecdk/no-cdk-api-above-floor`
ESLint rule blocks known version-gated APIs statically, and the `cdk-floor`
harness synthesises against a real old CDK.

## Consequences

- Consumers get honest, per-package ranges; low-floor packages stay broadly
  installable.
- Floors are regression-proof: `check` stops the ranges drifting from the
  manifest, `enforce` stops a package quietly requiring a newer CDK.
- Lowering a floor is a deliberate, evidenced act: remove the requiring API,
  re-run `establish` to prove the lower floor, refine the manifest, `apply`.
- The import probe is a lower bound; a runtime-only requirement could push a
  floor above the established value, caught by the synth/suite layers.
- Floors are pinned to the exact introducing release. They will rise over time
  as packages adopt newer CDK features — that is expected and intentional, and
  the tooling makes each change measured rather than assumed.
