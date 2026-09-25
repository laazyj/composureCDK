# Project Instructions

## Architecture

Read [docs/architecture.md](docs/architecture.md) first — it's the primary guide to the library's shape: lifecycle, builders, composition, refs, defaults. For decisions that amend or add detail (and the rationale behind non-obvious patterns), see [docs/adr/](docs/adr/).

**ADRs are for architecturally significant decisions only** — ones that change the library's shape or bind work across packages. An implementation choice localised to one feature, or to a set of features inside a single package, does not get an ADR: document it in the package README and the PR body. Applying an existing pattern to a new service is not a new decision. Read [when to write an ADR](docs/adr/README.md#when-to-write-an-adr) before adding one; the default answer is no.

## After making changes

Always run lint and format checks after each task, before presenting work for review:

```sh
npx nx run-many -t lint
npx nx prettier:check
```

Fix any issues before moving on. Use `npx nx run-many -t lint -- --fix` and `npx nx prettier:write` to auto-fix.

If you touched anything under `.github/workflows/`, also run:

```sh
npx nx actionlint
```

`npx nx run-many -t lint` is eslint only and will not look at a workflow file. See [linting the workflows](docs/ci.md#linting-the-workflows) — it is a separate gate because a broken workflow is one of the few things CI cannot catch for you. It needs `shellcheck >= 0.9` on `PATH`, which containers often lack; install it rather than skipping the gate.

## Build system

This is an nx monorepo and **nx is the only task runner**. Packages' targets are derived from their shape by [`tools/package-targets.mjs`](tools/package-targets.mjs); the workspace-wide gates are targets on the `workspace-root` project in [`project.json`](project.json). `npx nx verify` runs the lot, and is what the pre-push hook and CI run. The root `package.json` keeps five scripts (`build`, `test`, `lint`, `format`, `verify`) purely so the familiar commands work; each is a one-line forward to an nx target and nothing more. See [docs/build-system.md](docs/build-system.md) for why it is built this way — read it before changing `nx.json`, `project.json` or the plugin.

**Install dependencies with `npx -y npm@11 ci`**, not `npm install -g npm@11` — the self-upgrade fails in agent sandboxes.

Rules:

- **Never add a `scripts` block to a package.** It silently shadows the derived target and puts the task back behind `npm run`, which is what [#323](https://github.com/laazyj/composureCDK/issues/323) was. A root script is allowed only if it forwards to one nx target verbatim — no flags, no `&&`, no logic. Anything that needs configuration is a target, not a script.
- **The plugin supplies the command; `targetDefaults` in [`nx.json`](nx.json) supply the scheduling** (`dependsOn`, `cache`, `inputs`, `outputs`). A target unique to one package goes in that package's own `project.json`, not behind a conditional in the plugin.
- **The plugin must not import anything the repo builds** — nx loads it during graph construction. This is also why `@nx/eslint` is not used.
- **A new workspace-wide gate** is a target on `workspace-root`, and must be added to `verify`'s `dependsOn` and to `ci.yml`; `npx nx ci:covers-verify` fails otherwise.
- **A new source file outside `packages/`** must be covered by the `workspace-root` `lint` target in the root [`project.json`](project.json); a plain `.mjs` also needs adding to both lists that name it in `eslint.config.mjs`.
- **`sharedGlobals` must stay declared** in `namedInputs`, and `package.json` must stay in `production` — tshy reads its build config from there.

## Publishing & module format

Every publishable package ships dual ESM/CJS, built by `tshy` — see [ADR-0007](docs/adr/0007-dual-esm-cjs-publishing.md). When touching a builder package:

- Do not use `import.meta` or top-level `await` in `src/` — neither emits to CommonJS. The `composurecdk/no-cjs-incompatible-syntax` ESLint rule enforces this.
- Cross-realm identity checks must use a `Symbol.for(...)` brand, never `instanceof` — the ESM and CommonJS copies of a package can both load in one process. The `composurecdk/no-realm-bound-instanceof` ESLint rule enforces this, for imports from a relative path as much as a bare specifier. For a CDK construct, brand the L2 you cannot modify by reading its L1 instead (`CfnResource.isCfnResource` + `cfnResourceType`, [ADR-0011](docs/adr/0011-cross-component-relationship-guards.md)).
- A prop re-declared only to widen it to `Resolvable` must read its inner type from CDK's own prop — `Resolvable<NonNullable<TopicProps["masterKey"]>>`, never `Resolvable<IKey>` — so it keeps tracking the consumer's installed `aws-cdk-lib` as CDK migrates its prop types ([ADR-0018](docs/adr/0018-re-declared-props-track-cdk-prop-types.md)). Keep the indexed access inline: a named alias puts an unnameable type into the emitted builder type and reintroduces [ADR-0001](docs/adr/0001-builder-type-emission.md)'s TS2883. The `composurecdk/redeclared-prop-must-track-cdk-type` ESLint rule enforces this.
- Run `npx nx verify` before pushing. It chains the same gate CI runs — build, `check:exports` (`attw` + `publint`), lint, test — and a husky `pre-push` hook runs it automatically.
- A new package must be added to `@composurecdk/module-compat`'s `DUAL_PACKAGES` list and `peerDependencies`, and to `cdk-flags.json`'s `modules` map — `npx nx cdk-flags:check` fails until it is there.

## CDK feature flags

`cdk-flags.json` records a decision for every feature flag `aws-cdk-lib` ships for a service this repo wraps. `npx nx cdk-flags:check` — part of `verify` and its own CI step — fails when a CDK upgrade introduces one with no entry, so the manifest cannot silently fall behind.

Scope is the `modules` map: each package lists the aws-cdk-lib modules it wraps, `[]` if it wraps none. That makes the boundary self-guarding in both directions — a new service's flags stay out of scope without an edit, and **a new package with no entry fails the check**, so its flags cannot leave review unnoticed. CDK spells some modules more than one way (both `customresources` and `custom-resources`), so `check` also fails when a CDK module's name matches a package that does not list it. Flags CDK declares but removed in v2 are skipped; `check` derives those from the absence of `introducedIn.v2`.

Each entry carries a `status`, the `recommended` value it was decided against, and a reason — either its own `because` or the shared one in `statusReasons`. A status with no reason fails the check, and so does an entry whose `recommended` no longer matches CDK's, since a changed recommendation reopens the decision.

- `adopted` — set in [`packages/examples/cdk.json`](packages/examples/cdk.json), with the value. `check` asserts the two agree; [`app-context.test.ts`](packages/examples/test/app-context.test.ts) keeps the third copy, `EXAMPLE_CONTEXT`, in step.
- `declined` — a deliberate no.
- `no-effect` — setting it changes nothing in any example stack's synthesised cloud-assembly artifact. This is evidence rather than judgement: `npx nx cdk-flags:audit` re-measures it, comparing each stack's template _and_ its artifact manifest rather than a chosen subset of fields, because a curated list only grows when someone notices a gap. Widening the comparison does not close the other way a verdict goes hollow: the audit also has to supply the same synth _inputs_ the CDK CLI does, and `CLI_CONTEXT` in the script is a hand-maintained list of exactly that. Read it narrowly — it says nothing changes in the 14 stacks we ship, not that the flag cannot affect a builder no example exercises. Where the real reason is that a builder already guarantees the flag's intent, say so in `because` instead of leaning on the shared reason.

`audit` is manual rather than part of `verify` because it synthesises the whole example app once per flag — the same split as `cdk-floors establish` versus `cdk-floors check`. Run it after a CDK upgrade, and whenever an example starts exercising something it did not before.

## Release artefacts

`CHANGELOG.md` files (root and per-package) are generated by the release process. Never edit them by hand; describe behaviour changes in the PR body and commit message instead, and the release tooling will compose the entry.

## Adding a new example

Examples are expansive demonstrations, not feature showcases. Each one is a simplified real-world application built from several features working together, deployed by CI and proven against live AWS by a smoke test. Before adding one, check it clears this bar:

- **It demonstrates a system, not a resource.** One feature or one resource type is the job of the package README and that package's tests. An example earns its place by showing how a set of features composes into something recognisable — an API over a datastore, a queue-driven worker, a website behind a CDN.
- **It is grounded in a use case.** Name the workload the stack would serve. If the best available description is "shows how X works", it is package-README material.
- **It does not re-demonstrate what existing examples already cover.** Alarm routing through `alarmActionsPolicy` and an SNS topic, for instance, already appears in several stacks; repeating it adds deploy cost and obscures whatever is actually new. Prefer extending an existing example over adding a near-duplicate stack.
- **It is deployable and verifiable.** CI deploys every example; an example whose behaviour cannot be exercised by a smoke test is not worth deploying, so write the smoke test as part of adding it (step 4).

When adding a stack to `packages/examples/`:

1. **Name the stack with the `ComposureCDK-` prefix.** The CI IAM policy and the smoke test discover stacks by this prefix — see [docs/ci.md](docs/ci.md#stack-naming-convention).
2. **Register it in [`packages/examples/src/apps.ts`](packages/examples/src/apps.ts)** — the single registry of examples, used by both the `bin/app.ts` entrypoint CI deploys and the tests that assert across every stack.
3. **Add a row to [`packages/examples/README.md`](packages/examples/README.md).**
4. **Add a post-deploy smoke test that exercises it.** The runner at [`scripts/smoke-test.mjs`](scripts/smoke-test.mjs) (run by the `deploy-test` workflow) auto-discovers `*.smoke.mjs` files under [`packages/examples/test/smoke/`](packages/examples/test/smoke/). Stack health (`CREATE_COMPLETE` / `UPDATE_COMPLETE`) is checked automatically via the prefix, but that only proves the stack deployed — **it is not sufficient**. Add a sibling `<name>.smoke.mjs` that drives the example's runtime surface end to end and asserts the effect: call the endpoint and check the response, send the message or write the record and check the consumer's log line (which also proves its execution role had the permissions it needed). Each module default-exports `{ name, run(ctx) }`, where `ctx` provides `aws`, `region`, `pass(msg)`, and `fail(msg)`. Shared AWS CLI plumbing (output lookups, resource discovery, log polling, retries) lives in [`packages/examples/test/smoke/_helpers.mjs`](packages/examples/test/smoke/_helpers.mjs) — extend it rather than re-implementing a variant per check.
5. **Grant any AWS permissions the smoke test needs.** The check runs as the deploy-test OIDC role, not the CDK execution role, so an action it calls against the deployed stack (publishing a message, writing an item, invoking a function) needs a statement in [`.github/cloudformation/github-oidc-role.yml`](.github/cloudformation/github-oidc-role.yml), scoped the way its neighbours are, plus a line in [docs/ci.md](docs/ci.md#security-notes). That stack is deployed by hand, so say so in the PR — it must be redeployed before the next `deploy-test` run or the check fails with `AccessDenied`.

Once it synthesises, run `npx nx cdk-flags:audit`: a new stack can make a feature flag that changed nothing start mattering, and the manifest's `no-effect` verdicts are measured against these stacks. See [CDK feature flags](#cdk-feature-flags).

Per-stack unit/synth tests live in [`packages/examples/test/`](packages/examples/test/) — add one alongside the example following the existing patterns. These are separate from the post-deploy smoke checks under `test/smoke/`.
