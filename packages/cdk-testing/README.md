# @composurecdk/cdk-testing

Internal, CDK-aware test helpers shared across the `@composurecdk/*` suites. Private to the workspace; not published.

## Why this package exists

`@composurecdk/core/testing` is the existing home for shared test helpers, and is the wrong home for these, on two counts.

It is public API. `core/testing` is a published subpath: a consumer writing their own builder gets `assertCopyPreservesState` to prove their `[COPY_STATE]` hook, so its helpers are agnostic and carry a semver surface. The helpers here are coupled to this repo's own suites and are not a contract to offer anyone. Hence `"private": true`, as for `examples` and `module-compat`: no dual ESM/CJS publishing, no `DUAL_PACKAGES` entry in `@composurecdk/module-compat`, no `check:exports` gate.

It is CDK-version-agnostic by rule. `@composurecdk/core` declares no `aws-cdk-lib` dependency, and the root `eslint.config.mjs` bans the import from `packages/core/src/**` (see [docs/architecture.md](../../docs/architecture.md)). Every helper here needs `App`, `Stack` or `Template`.

So the split is not "shared vs. not shared":

| a helper that…                                                          | belongs in                   |
| ----------------------------------------------------------------------- | ---------------------------- |
| tests a contract a consumer also implements, and needs no `aws-cdk-lib` | `@composurecdk/core/testing` |
| encodes how this repo's own suites are written, or needs `aws-cdk-lib`  | `@composurecdk/cdk-testing`  |

## Usage

Add it as a devDependency of the consuming package and import from the root entry:

```jsonc
// packages/<pkg>/package.json
"devDependencies": {
  "@composurecdk/cdk-testing": "*"
}
```

```ts
import { assertAssignable, newStack, policyJson, testEnv } from "@composurecdk/cdk-testing";

const stack = newStack({ env: testEnv("us-east-1") });
```

## What's here

| export                                       | what it does                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `newStack(props?)`                           | A `Stack` in a fresh `App`. Pass `props.env` for an environment-specific stack.                                  |
| `testEnv(region)`                            | A `TestEnvironment` for that region on `TEST_ACCOUNT`.                                                           |
| `TestEnvironment`                            | CDK's `Environment` with `account` and `region` required, which `testEnv` always supplies.                       |
| `TEST_ACCOUNT`                               | The fictitious account those environments name.                                                                  |
| `buildFixture(factory, id, defaults?)`       | Binds a builder factory and construct id into a build-and-synthesise fixture.                                    |
| `policyJson(stack)`                          | The synthesised template as a JSON string, for substring assertions over IAM policy documents.                   |
| `tagsPerResource(template, type)`            | The tags on each resource of that type — owns the `findResources` cast. For assertions a matcher cannot express. |
| `CfnTagEntry`                                | A CloudFormation tag (`Key`/`Value`) as it appears in a synthesised template.                                    |
| `assertAssignable<Target, Source>()`         | A compile-time assignability assertion — how the ADR-0018 type-level prop guards are written.                    |
| `assertCapabilitiesCovered(grants, covered)` | Pins a suite's capability table against the keys of the grants object it tests.                                  |

### Why `assertAssignable` and not vitest's `assertType`

vitest's `assertType<T>(value: T)` makes the same assignability check, and is not gated on `--typecheck` (its runtime implementation is an empty function). It is weaker on two counts: it takes a value, so each site carries an `undefined as unknown as CdkProps` cast to supply one; and dropping its type argument infers `T` from that argument and passes vacuously, where dropping one here is `error TS2558: Expected 2 type arguments, but got 1`.

`expectTypeOf(...).toExtend()` is a different check — a conditional-type `extends`, which distributes over unions where assignability does not.

### Using `buildFixture`

Bind it once per suite, naming the local `buildAndSynth`:

```ts
const buildAndSynth = buildFixture(createQueueBuilder, "TestQueue");

const { template } = buildAndSynth((b) => b.fifo(true));
const { result } = buildAndSynth((b) => b.recommendedAlarms(true));
```

It is curried because the factory and id are fixed per suite while the configure callback varies per test, so binding keeps each call site to its one meaningful argument. `defaults` and the optional second argument to a bound fixture carry `stackProps` and `context`; a call's `stackProps` replaces the fixture's rather than merging, so `{}` gives an environment-agnostic stack where the fixture supplies an `env`.

## What this package may depend on

It is tagged `scope:testing`, which `eslint.config.mjs` allows to depend on `scope:core` and nothing else. So `@composurecdk/core` is a devDependency and its contracts — `Lifecycle`, `Grant` — are imported rather than restated structurally.

A `scope:lib` package is out of bounds: every library's tests depend on these helpers, so the helpers must sit below all of them. In practice the cycle detector already catches that today, since every library reaches back here; the tag is what holds when a new one does not yet.

`@composurecdk/eslint-plugin` keeps `scope:tooling` ("depends on nothing"), which it genuinely needs — every package's `lint` target depends on its `build`, and the root flat config imports its compiled output.

## Why `aws-cdk-lib` is a devDependency, and not in `cdk-floors.json`

A devDependency, because the package needs `aws-cdk-lib` to build and test itself, and because `@nx/enforce-module-boundaries`' `banTransitiveDependencies` would otherwise flag the import as phantom. Not a peer: peers declare what an installing consumer's host must provide, and a private package has no installing consumers. Not a regular dependency: npm could resolve a nested copy the floor override does not reach, giving two `aws-cdk-lib` realms in one process (see [ADR-0007](../../docs/adr/0007-dual-esm-cjs-publishing.md)).

Not in [`cdk-floors.json`](../../cdk-floors.json). `cdk-floors enforce` writes `overrides: { "aws-cdk-lib": <floor> }` into the root package.json, which npm applies tree-wide, then runs the test target for the packages at that floor. A helper imported by a consumer's test resolves that hoisted, floor-pinned copy whatever this package declares, so the helpers are already exercised at the floors of the packages that use them.

A single declared floor could not improve on that. There are 12 distinct floors across the packages, from 2.1.0 to 2.225.0; the lowest would constrain helpers on behalf of packages that never run there, and anything higher would miss the low-floor consumers. See [ADR-0008](../../docs/adr/0008-aws-cdk-lib-version-floors.md).

## Adding a helper

The bar is duplication that already exists: two or more packages have independently written the helper. Check it against the split above first — one that tests a contract consumers implement too, and needs no `aws-cdk-lib`, belongs in `core/testing`.

1. Add `src/<kebab-name>.ts` with TSDoc that says what the helper asserts and, where it is not obvious, what it deliberately does not.
2. Re-export it from `src/index.ts`.
3. Add `test/<kebab-name>.test.ts`. Coverage thresholds are 100% per file.
4. Add a row to the table above.
5. Migrate the existing copies in the same sweep, or the next one — a helper with no call sites is duplication with extra steps.
