# Project Instructions

## Architecture

Read [docs/architecture.md](docs/architecture.md) first — it's the primary guide to the library's shape: lifecycle, builders, composition, refs, defaults. For decisions that amend or add detail (and the rationale behind non-obvious patterns), see [docs/adr/](docs/adr/). Non-trivial changes that introduce a new pattern or reverse an existing one should ship with an ADR.

## After making changes

Always run lint and format checks after each task, before presenting work for review:

```sh
npm run lint
npm run format:check
```

Fix any issues before moving on. Use npm run lint:fix and npm run format to auto-fix.

## Build system

Use npx nx to run build/test scripts — this is an nx monorepo.

Lint is an nx target too: `npm run lint` runs `nx run-many -t lint`, which caches per project so unchanged packages fast-succeed. Each package carries a `"lint": "eslint ."` script, so nx infers a `lint` target the same way it infers `build`/`test`/`typecheck` from package.json scripts — add that line when you create a package. Three things make this correct rather than merely fast:

- **Loose top-level files** (`eslint.config.mjs`, `scripts/**`, `vitest.config.base.ts`) belong to no package, so they are linted by the `workspace-root` project defined in the root [`project.json`](project.json). If you add a source file outside `packages/` and outside those globs, extend that project's `lint` target so it stays covered.
- **The custom rules** in `@composurecdk/eslint-plugin` drive every package's lint result, so `targetDefaults.lint` in [`nx.json`](nx.json) both depends on that package's `build` (the flat config imports its compiled output) and lists its `src/**` as a lint input, so a rule change busts the dependent lint caches.
- **Not the `@nx/eslint` inference plugin.** It would auto-create the `lint` targets, but it evaluates the root flat config during graph construction (to skip projects with no lintable files). That imports `@composurecdk/eslint-plugin` before it is built, so every nx command fails on a fresh checkout. Per-package scripts avoid loading the config until lint actually runs — by which point `dependsOn` has built the plugin.

### Targets run the tool directly, not `npm run`

Each package's `package.json` maps its hot targets (`build`, `typecheck`, `test`, `check:exports`, `lint`) to `nx:run-commands` under an `"nx": { "targets": … }` block, each running the tool directly (`tsc --noEmit`, `eslint .`, …) with `"cwd": "{projectRoot}"`. The `scripts` entries stay — they remain the source of truth for each command and keep `npm run <script>` working for humans — and the `nx.targets` block mirrors them.

Without this block, nx _infers_ those targets from the scripts and runs them through the package manager (`npm run <script>`), spawning one `npm` process per task. Under CI's parallelism those concurrent `npm` startups intermittently crash inside npm's own config loader (`Exit prior to config file resolving` / `call config.load() before reading values`), failing the task _before_ the underlying tool runs — a flake unrelated to the code. Running the tool directly removes the `npm` subprocess entirely. `targetDefaults` in [`nx.json`](nx.json) still supply each target's `dependsOn`/`cache`/`inputs`/`outputs`; the override only changes the executor. When you add a package, copy the `nx.targets` block (adjusting `build` — `tshy` for publishable packages, `tsc -p tsconfig.build.json` otherwise).

The override has to live in each `package.json` — it cannot be hoisted into one shared inference plugin, and `targetDefaults` cannot carry it either. Two nx facts (verified on 23.x) force this: `targetDefaults` can set an executor but nx ignores it for a target a plugin already inferred; and nx loads workspace `plugins` _before_ its built-in `package-json` inference (`specifiedPlugins.concat(defaultPlugins)`), and the last plugin wins the merge — so a local `createNodes` plugin's `nx:run-commands` targets are clobbered by the built-in `nx:run-script` inference. A package's own `nx.targets` (read by that same built-in plugin) is the only thing that overrides its inferred script targets, so the per-package repetition is load-bearing, not incidental.

## Publishing & module format

Every publishable package ships dual ESM/CJS, built by `tshy` — see [ADR-0007](docs/adr/0007-dual-esm-cjs-publishing.md). When touching a builder package:

- Do not use `import.meta` or top-level `await` in `src/` — neither emits to CommonJS. The `composurecdk/no-cjs-incompatible-syntax` ESLint rule enforces this.
- Cross-realm identity checks must use a `Symbol.for(...)` brand, never `instanceof` — the ESM and CommonJS copies of a package can both load in one process.
- Run `npm run verify` before pushing. It chains the same gate CI runs — build, `check:exports` (`attw` + `publint`), lint, test — and a husky `pre-push` hook runs it automatically.
- A new package must be added to `@composurecdk/module-compat`'s `DUAL_PACKAGES` list and `peerDependencies`.

## Release artefacts

`CHANGELOG.md` files (root and per-package) are generated by the release process. Never edit them by hand; describe behaviour changes in the PR body and commit message instead, and the release tooling will compose the entry.

## Adding a new example

When adding a stack to `packages/examples/`:

1. **Name the stack with the `ComposureCDK-` prefix.** The CI IAM policy and the smoke test discover stacks by this prefix — see [docs/ci.md](docs/ci.md#stack-naming-convention).
2. **Register it in [`packages/examples/bin/app.ts`](packages/examples/bin/app.ts).**
3. **Add a row to [`packages/examples/README.md`](packages/examples/README.md).**
4. **Ensure it is covered by the post-deploy smoke test.** The runner at [`scripts/smoke-test.mjs`](scripts/smoke-test.mjs) (run by the `deploy-test` workflow) auto-discovers `*.smoke.mjs` files under [`packages/examples/test/smoke/`](packages/examples/test/smoke/). Stack-health checks are automatic via the prefix; if your example exposes a runtime surface that the smoke test should hit (HTTP endpoint, distribution, log output, etc.), add a sibling `<name>.smoke.mjs` file there. Each module default-exports `{ name, run(ctx) }`, where `ctx` provides `aws`, `region`, `pass(msg)`, and `fail(msg)`. Shared AWS CLI plumbing (output lookups, resource discovery, polling) lives in [`packages/examples/test/smoke/_helpers.mjs`](packages/examples/test/smoke/_helpers.mjs).

Per-stack unit/synth tests live in [`packages/examples/test/`](packages/examples/test/) — add one alongside the example following the existing patterns. These are separate from the post-deploy smoke checks under `test/smoke/`.
