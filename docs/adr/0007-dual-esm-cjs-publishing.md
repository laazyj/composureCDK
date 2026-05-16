# ADR 0007: Dual ESM/CJS publishing as an enforced standard

- **Status:** Accepted
- **Date:** 2026-05-14

## Context

Every `@composurecdk/*` package shipped ESM-only: `"type": "module"` with an
`exports` map exposing just `import` and `types`. A CommonJS consumer — notably
`cdk synth` run from a `ts-node`/Jest app compiled to CommonJS — cannot
`require()` an ESM-only package, so the whole library was unreachable from that
(common) setup. This was reported against `@composurecdk/cloudwatch` but applied
to all 16 packages.

Patching one package would leave the rest broken and the pattern unenforced.
The decision is to make dual publishing a project-wide, regression-proof
standard.

## Decision

**Every publishable `@composurecdk/*` package ships both an ESM and a CommonJS
build, produced by [`tshy`](https://github.com/isaacs/tshy). Regression
enforcement runs as nx targets / npm scripts — locally first, with CI as a thin
executor of the same targets.**

### Build: `tshy`

`tshy` replaces the per-package `tsc -p tsconfig.build.json` build. It compiles
`src/` twice — to `dist/esm` and `dist/commonjs` — writes a per-directory
`package.json` `type` marker into each, and generates the dual-condition
`exports` map (plus `main`/`types`/`module`). Each package declares only its
source entry points in a `tshy.exports` block; `tshy` owns the generated fields.
`declaration` is enabled in each package's `tsconfig.json` (the config `tshy`
extends) — without it `tshy` emits no `.d.ts`.

Packages with subpath exports keep them: `@composurecdk/core` exposes
`./testing`, `@composurecdk/route53` exposes `./zone`.

`@composurecdk/examples` and `@composurecdk/eslint-plugin` stay on plain `tsc` —
both are `private` and never published (`examples` is a CDK app,
`eslint-plugin` is consumed only within the workspace).

### Supported Node version

The floor is **Node 20** — the oldest LTS in maintenance, and a version that
fully supports the `exports` field. The legacy "node10" module-resolution
algorithm is explicitly _not_ a target: `attw` runs with `--profile node16`.
Each package declares `engines.node: ">=20"`.

### Enforcement is local-first

The enforcement mechanisms are nx targets / npm scripts, identical in shape to
`build`/`lint`/`test`. CI runs the same targets — it is not where enforcement
_lives_. A maintainer running `npm run verify` gets the exact gate CI runs.

| Mechanism                                             | What it catches                                                                                  | Feedback point                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `composurecdk/no-cjs-incompatible-syntax` ESLint rule | `import.meta` / top-level `await` in `src/` — no CJS emit                                        | In-editor, instant                         |
| `attw` + `publint` (`check:exports` nx target)        | Broken/masquerading exports, dual-package issues, packaging mistakes                             | `npm run check:exports` / `npm run verify` |
| `@composurecdk/module-compat` consumption tests       | A package failing to resolve under `require()` or `import`, or the CJS `cdk synth` path breaking | `npm test` / `npm run verify`              |
| husky `pre-push` hook                                 | Any of the above reaching GitHub                                                                 | Automatic, before push                     |
| CI Node 20 + 24 matrix                                | Version-specific resolution breakage                                                             | CI (the one genuinely CI-only check)       |

### Dual-package hazard

When both the ESM and CommonJS copies of a package load in one process, they
are distinct module instances — `instanceof` and other realm-bound checks fail
across the boundary. `COPY_STATE` and the lambda event-source brand already use
`Symbol.for(...)`, which is realm-agnostic. `Ref` was the exception: `isRef`
used `value instanceof Ref`. It now brands every `Ref` with
`Symbol.for("composurecdk.ref")` and `isRef` checks that brand (see
[architecture.md](../architecture.md#ref)).

## Consequences

- CommonJS consumers — including the `cdk synth` path from issue #119 — can use
  the library. The `exports` change is purely additive, so this is a `feat:`
  minor bump, not a breaking change.
- Adding a new builder package now means adding a `tshy` config block and a
  `check:exports` script, and registering the package in
  `@composurecdk/module-compat`'s `DUAL_PACKAGES` list and `peerDependencies`.
- New cross-realm identity checks must use a `Symbol.for(...)` brand, never
  `instanceof` — the dual-package boundary makes `instanceof` unreliable.
- `import.meta` and top-level `await` are banned in library `src/` (the ESLint
  rule enforces it) because neither emits to CommonJS.
- `nx`'s `typecheck` target depends on the package's own `build`: `tshy` writes
  a transient `src/package.json` during its build, and a `typecheck` running
  concurrently would intermittently misresolve module formats.
- CI gains a Node 20 + 24 matrix; the per-package `attw`/`publint` and the
  `module-compat` suite add a few minutes to the run.

## Alternatives considered

- **`tsc`-twice** (per-package ESM+CJS tsconfigs plus a `{"type":"commonjs"}`
  shim). No new dependency, but config boilerplate ×16 and a hand-maintained
  `exports` map per package.
- **A bundler** (`tsup`/`unbuild`/`pkgroll`). Bundling semantics diverge from
  today's straight `tsc` emit; rejected to keep the build transparent.
- **Staying ESM-only and relying on `require(esm)`.** Not broadly available
  across the supported Node range, and it does not fix the `ts-node`/Jest CJS
  case in issue #119.
- **Enforcement in CI only.** Rejected — it makes the feedback loop a push away.
  composureCDK's CI already just runs `npm run` scripts, so enforcement is
  implemented as nx targets that run locally and in CI alike.
