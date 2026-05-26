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

Functional gaps are treated differently from cosmetic ones. Where a too-old CDK
would silently produce a **broken** resource rather than a merely-untagged one,
the requiring feature _does_ raise the floor — e.g. `cloudfront` floors at 2.124.0
because `aws-cloudfront.FunctionProps.keyValueStore` only wires the key-value-store
association from that release, and a function silently missing its store is a
runtime defect, not cosmetic.

The unit suites encode this: tag-propagation tests probe (by synthesis) whether the
installed CDK tags the resource and assert tags-present-or-gracefully-absent
accordingly, so `enforce` stays green at the floor without weakening the assertion
at the latest CDK.

`scripts/cdk-floors.mjs` provides the modes (npm scripts `cdk-floors:*`):

- **`apply`** — writes each package's `peerDependencies.aws-cdk-lib` from the
  manifest.
- **`check`** — asserts package.json ranges match the manifest. Cheap; runs in
  the main CI job and `verify`.
- **`enforce`** — for each declared floor, forces aws-cdk-lib to it (a temporary
  npm `overrides` on a from-scratch install, which binds every copy in the tree
  rather than just the hoisted one), asserts the floor actually bound, then runs
  that floor's package group's unit suite against it. The "don't breach the
  floor" PR gate, sharded one floor per CI job. The suites synthesise builders
  and policies via partial-matcher assertions, so this catches both import-time
  (missing named export) and runtime (a too-new method call, e.g. the #146
  `CfnAlarm.isCfnAlarm` inside an Aspect) version-gated APIs.
- **`establish`** — discovery tool: packs every publishable `@composurecdk/*`
  package and probes each against a descending ladder of real aws-cdk-lib
  releases (default 13 rungs from 2.230 down to 2.1; override via
  `CDK_FLOOR_LADDER`). Records the lowest version each package loads on and the
  gating export, writing a ladder-granular draft (`cdk-floors.discovered.json`)
  to be refined into `cdk-floors.json`. Manual; used when establishing initial
  floors or **deliberately lowering** an existing one (drop the requiring API,
  re-establish to prove the lower floor, refine, `apply`).

Why `overrides` + a from-scratch install: every package also carries
`aws-cdk-lib` as a `devDependency` at the latest version, so simply downgrading
the hoisted root copy leaves a nested latest copy that the package's suite would
resolve instead — `enforce` would then silently pass against the wrong version.
An `overrides` entry forces the floor across the whole tree, but npm only honours
it on a clean install; hence the from-scratch reinstall and the post-install
resolution assertion that fails loudly if the floor did not actually bind.

A complementary `scripts/cdk-floor-validate.mjs` (`npm run cdk-floor:validate`,
also a `workflow_dispatch` workflow) synthesises a representative `compose()`
system against any chosen aws-cdk-lib version. On-demand only — for bug repro,
candidate-floor validation before editing the manifest, and release prep.
**Not a PR gate**, because no single fixed CDK version is the right one to
test against continuously; `enforce` (per-package, per-floor) is the gate.
Defaults to `max(declared floors)` from the manifest — the composed-system
floor — when no version is supplied.

This complements the static guard already in place: the
`composurecdk/no-cdk-api-above-floor` ESLint rule (`@composurecdk/eslint-plugin`)
blocks known version-gated APIs at lint time, so they can't be written into
`src/` in the first place.

## Consequences

- Consumers get honest, per-package ranges; low-floor packages stay broadly
  installable.
- The ranges become regression-proof in two layers: `check` stops package.json
  drifting from the manifest, and `enforce` stops a package quietly requiring a
  newer CDK than its declared floor — at both the import-time and runtime
  boundaries, since it runs the real unit suites at the floor.
- Lowering a floor is a deliberate, evidenced act: remove the requiring API,
  use `establish` to prove the lower floor, refine the manifest, `apply`.
- `enforce` mutates the tree (override + reinstall per floor). In CI each shard
  is a throwaway checkout; locally it requires `--force` and restores
  package.json / package-lock.json / node_modules afterwards (and on Ctrl-C),
  so it never leaves a stray override or a floor-pinned install behind.
- Floors are pinned to the exact introducing release. They will rise over time
  as packages adopt newer CDK features — that is expected and intentional, and
  the tooling makes each change measured rather than assumed.
