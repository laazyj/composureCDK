# ADR 0013: Per-file coverage thresholds enforced locally via vitest

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

The repo had no coverage enforcement: nothing failed a build if a new builder,
policy, or alarm-config file shipped with zero tests. Codecov-style PR
dashboards were considered, but for this repo they mostly show line coverage
that's trivially gamed — a test that synthesises a stack without asserting on
the output still touches every line. They're also visibility-only unless
paired with a required-status-check gate on a hosted service, which doesn't
run locally and doesn't block a developer's own machine.

What's actually valuable here is **branch** coverage: this codebase's
interesting logic is almost entirely in defaults-merging, mutual-exclusion
validation, and `Resolvable`/`Ref` branches (see ADR-0009, ADR-0010, ADR-0011)
— code that's hard to exercise without a real assertion on the outcome, unlike
straight-line construct calls.

## Decision

**Every package enforces per-file (`perFile: true`) vitest coverage
thresholds, checked as part of the existing `test` target — no separate CI
job, no hosted dashboard.** A file that dips below its package's threshold
fails the build on its own, rather than being averaged into a package-wide
number a single well-tested file could mask.

- `vitest.config.base.ts` (repo root) exports `withCoverage(thresholds,
config?)`, wrapping `@vitest/coverage-v8` with `provider: "v8"`, `enabled:
true`, and `reporter: ["text"]` (no `html` — nothing in CI consumes it, and
  writing it on every run/rerun is pure disk I/O for no reader).
- Each package's `vitest.config.ts` calls `withCoverage({ statements,
branches, functions, lines })` with **that package's own measured floor**,
  not a repo-wide default. Coverage varies genuinely by package — CDK builder
  packages with heavy validation logic (e.g. `iam`, `route53`) sit well below
  packages that are mostly declarative wiring (e.g. `s3`, `sns`) — so a single
  shared number would either be too loose everywhere or fail everywhere.
- Because it's wired into the `test` target, it runs on `npm run verify`,
  which the existing husky `pre-push` hook already calls — so a regression is
  caught before it leaves a contributor's machine, not just in CI.
- Where baselining surfaced a genuinely untested-but-testable gap (a function
  only exercised indirectly by a downstream package's tests, or a `Ref`
  branch nothing exercised), the gap was closed with a real test rather than
  excluded or backed off — coverage.exclude / vitest's per-glob threshold
  overrides quietly hide the gap from every future run, they don't fix it.

## Consequences

- A new file with no test fails `npm test` locally immediately (0% never
  clears any package's floor), which was the whole point.
- The per-package thresholds are floors measured from a point-in-time
  baseline, not a target — they only ratchet up if someone tightens them by
  hand after adding tests. Vitest's `coverage.thresholds.autoUpdate` can
  mechanize re-baselining later if the hand-maintained numbers drift, but that
  wasn't wired up here — the numbers only needed setting once for this change.
- Coverage is instrumented on every `npm test` invocation (including via
  `test:watch`), since the threshold gate is what makes this useful; there is
  no fast/uninstrumented mode. In practice the added overhead is small — v8
  coverage is native, not a source transform — so it wasn't judged worth a
  second code path to opt out of.
- Contributors adding a package must set its own thresholds from a real
  `vitest run --coverage` baseline rather than copying a neighboring
  package's numbers, since the floor is meant to reflect what that package's
  tests actually reach today.
