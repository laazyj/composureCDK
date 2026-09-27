# Project Instructions

## Architecture

Read [docs/architecture.md](docs/architecture.md) first — it's the primary guide to the library's shape: lifecycle, builders, composition, refs, defaults. For decisions that amend or add detail (and the rationale behind non-obvious patterns), see [docs/adr/](docs/adr/).

**ADRs are for architecturally significant decisions only** — ones that change the library's shape or bind work across packages. An implementation choice localised to one feature, or to a set of features inside a single package, does not get an ADR: document it in the package README and the PR body. Applying an existing pattern to a new service is not a new decision. Read [when to write an ADR](docs/adr/README.md#when-to-write-an-adr) before adding one; the default answer is no.

## After making changes

Run the gates after each task, before presenting work for review:

```sh
npx nx run-many -t lint
npx nx prettier:check
npx nx actionlint          # only if you touched .github/workflows/
```

Auto-fix with `npx nx run-many -t lint -- --fix` and `npx nx prettier:write`. `actionlint` is separate because eslint does not read workflow files, and a broken workflow is one of the few things CI cannot catch for you; it needs `shellcheck >= 0.9` on `PATH`, which containers often lack — install it rather than skipping the gate. `npx nx verify` runs everything, and the pre-push hook runs it for you.

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

Every publishable package ships dual ESM/CJS, built by `tshy` ([ADR-0007](docs/adr/0007-dual-esm-cjs-publishing.md)). Each rule below has an ESLint rule behind it, so you will be told — but knowing why saves a fight with the linter:

- **No `import.meta` or top-level `await` in `src/`** — neither emits to CommonJS (`composurecdk/no-cjs-incompatible-syntax`).
- **Cross-realm identity checks use a `Symbol.for(...)` brand, never `instanceof`** (`composurecdk/no-realm-bound-instanceof`) — the ESM and CJS copies of a package can both load in one process, for a relative import as much as a bare specifier. Brand a CDK L2 you cannot modify by reading its L1 instead (`CfnResource.isCfnResource` + `cfnResourceType`, [ADR-0011](docs/adr/0011-cross-component-relationship-guards.md)).
- **A prop re-declared only to widen it to `Resolvable` reads its inner type from CDK's own prop** (`composurecdk/redeclared-prop-must-track-cdk-type`) — `Resolvable<NonNullable<TopicProps["masterKey"]>>`, never `Resolvable<IKey>` — so it tracks the consumer's installed `aws-cdk-lib` ([ADR-0018](docs/adr/0018-re-declared-props-track-cdk-prop-types.md)). Keep the indexed access inline: a named alias puts an unnameable type into the emitted builder type and reintroduces [ADR-0001](docs/adr/0001-builder-type-emission.md)'s TS2883.
- **A new package** must be added to `@composurecdk/module-compat`'s `DUAL_PACKAGES` list and `peerDependencies`, and to `cdk-flags.json`'s `modules` map.

## CDK feature flags

`cdk-flags.json` records a decision for every feature flag `aws-cdk-lib` ships for a service this repo wraps. Each entry is `adopted` (and set in [`packages/examples/cdk.json`](packages/examples/cdk.json)), `declined` or `no-effect`, and each needs a reason. `npx nx cdk-flags:check` fails when a CDK upgrade ships a flag with no entry, when a `recommended` value changes, or when a package has no `modules` entry. See [docs/cdk-feature-flags.md](docs/cdk-feature-flags.md) for what the statuses mean and how `no-effect` is measured.

- **A new package needs a `modules` entry** listing the aws-cdk-lib modules it wraps, `[]` if none. The check fails until it is there.
- **`npx nx cdk-flags:audit` is manual** — it synthesises the whole example app once per flag. Run it after a CDK upgrade, and whenever an example starts exercising something it did not before.

## Release artefacts

`CHANGELOG.md` files (root and per-package) are generated by the release process. Never edit them by hand; describe behaviour changes in the PR body and commit message instead, and the release tooling will compose the entry.

## Adding a new example

Examples are simplified real-world applications, not feature showcases — anything that demonstrates one resource or one feature belongs in a package README instead. The bar and the five-step checklist (stack naming, registration, the smoke test, the IAM grant) live in [packages/examples/README.md](packages/examples/README.md#adding-an-example). Read it before adding one.

Two obligations reach outside that package:

- **The smoke test's IAM statement lands in a hand-deployed stack.** Say so in the PR — [`github-oidc-role.yml`](.github/cloudformation/github-oidc-role.yml) must be redeployed before the next `deploy-test` run, or the check fails with `AccessDenied`.
- **Run `npx nx cdk-flags:audit` once it synthesises.** A new stack can make a feature flag that changed nothing start mattering, and the `no-effect` verdicts are measured against these stacks.
