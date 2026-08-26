# Project Instructions

## Architecture

Read [docs/architecture.md](docs/architecture.md) first — it's the primary guide to the library's shape: lifecycle, builders, composition, refs, defaults. For decisions that amend or add detail (and the rationale behind non-obvious patterns), see [docs/adr/](docs/adr/).

**ADRs are for architecturally significant decisions only** — ones that change the library's shape or bind work across packages. An implementation choice localised to one feature, or to a set of features inside a single package, does not get an ADR: document it in the package README and the PR body. Applying an existing pattern to a new service is not a new decision. Read [when to write an ADR](docs/adr/README.md#when-to-write-an-adr) before adding one; the default answer is no.

## After making changes

Always run lint and format checks after each task, before presenting work for review:

```sh
npm run lint
npm run format:check
```

Fix any issues before moving on. Use npm run lint:fix and npm run format to auto-fix.

If you touched anything under `.github/workflows/`, also run:

```sh
npm run actionlint
```

`npm run lint` is eslint only and will not look at a workflow file. See [linting the workflows](docs/ci.md#linting-the-workflows) — it is a separate gate because a broken workflow is one of the few things CI cannot catch for you. It needs `shellcheck >= 0.9` on `PATH`, which containers often lack; install it rather than skipping the gate.

## Build system

Use npx nx to run build/test scripts — this is an nx monorepo.

**Install dependencies with npm 11** (`npm install -g npm@11`). npm 10 and 11 disagree on how optional peer deps are pinned in the lockfile, and ours is generated under npm 11 — so under npm 10 `npm ci` fails with `Missing: yaml@2.9.0 from lock file`, and `npm install` "fixes" it by rewriting the lockfile, stripping `libc` fields npm 11 wrote. Neither is a defect in the lockfile and neither wants committing: CI pins npm 11 across the whole Node matrix for exactly this reason (see the `Pin npm` step in [ci.yml](.github/workflows/ci.yml)). Node 20 and 22 ship npm 10, so a default install on either needs the pin.

Lint is an nx target too: `npm run lint` runs `nx run-many -t lint`, which caches per project so unchanged packages fast-succeed. Each package carries a `"lint": "eslint ."` script, so nx infers a `lint` target the same way it infers `build`/`test`/`typecheck` from package.json scripts — add that line when you create a package. Three things make this correct rather than merely fast:

- **Loose top-level files** (`eslint.config.mjs`, `scripts/**`, `vitest.config.base.ts`) belong to no package, so they are linted by the `workspace-root` project defined in the root [`project.json`](project.json). If you add a source file outside `packages/` and outside those globs, extend that project's `lint` target so it stays covered.
- **The custom rules** in `@composurecdk/eslint-plugin` drive every package's lint result, so `targetDefaults.lint` in [`nx.json`](nx.json) both depends on that package's `build` (the flat config imports its compiled output) and lists its `src/**` as a lint input, so a rule change busts the dependent lint caches.
- **Not the `@nx/eslint` inference plugin.** It would auto-create the `lint` targets, but it evaluates the root flat config during graph construction (to skip projects with no lintable files). That imports `@composurecdk/eslint-plugin` before it is built, so every nx command fails on a fresh checkout. Per-package scripts avoid loading the config until lint actually runs — by which point `dependsOn` has built the plugin.

## Publishing & module format

Every publishable package ships dual ESM/CJS, built by `tshy` — see [ADR-0007](docs/adr/0007-dual-esm-cjs-publishing.md). When touching a builder package:

- Do not use `import.meta` or top-level `await` in `src/` — neither emits to CommonJS. The `composurecdk/no-cjs-incompatible-syntax` ESLint rule enforces this.
- Cross-realm identity checks must use a `Symbol.for(...)` brand, never `instanceof` — the ESM and CommonJS copies of a package can both load in one process. The `composurecdk/no-realm-bound-instanceof` ESLint rule enforces this, for imports from a relative path as much as a bare specifier. For a CDK construct, brand the L2 you cannot modify by reading its L1 instead (`CfnResource.isCfnResource` + `cfnResourceType`, [ADR-0011](docs/adr/0011-cross-component-relationship-guards.md)).
- Run `npm run verify` before pushing. It chains the same gate CI runs — build, `check:exports` (`attw` + `publint`), lint, test — and a husky `pre-push` hook runs it automatically.
- A new package must be added to `@composurecdk/module-compat`'s `DUAL_PACKAGES` list and `peerDependencies`.
- A package published under a **new npm name** — a new package, or an existing one losing `private` — needs two one-off manual steps before the next release: a first publish of that package alone and an `npm trust` trusted-publisher registration. See [adding a new package](docs/ci.md#adding-a-new-package), and say so in the PR — `release.yml` runs one `nx release publish` for the whole workspace, so a missing trusted publisher fails the entire release job.

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

Per-stack unit/synth tests live in [`packages/examples/test/`](packages/examples/test/) — add one alongside the example following the existing patterns. These are separate from the post-deploy smoke checks under `test/smoke/`.
