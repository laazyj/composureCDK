# Build system

Why the nx setup is shaped the way it is. [AGENTS.md](../AGENTS.md#build-system) carries the rules; this is the reasoning behind them.

## Targets are derived, not written

[`tools/package-targets.mjs`](../tools/package-targets.mjs) is an nx plugin that reads each `packages/*/package.json` and produces that package's targets. The packages are near-identical, so their commands were near-identical: 25 manifests repeating the same seven scripts, with nothing checking them for drift. Two predicates cover every difference — a `tshy` key means the package is dual-published ([ADR-0007](adr/0007-dual-esm-cjs-publishing.md)), so it builds with `tshy` and gets `check:exports`; failing that, a `tsconfig.build.json` means it builds with `tsc`. Everything else is uniform.

The plugin is the only copy of the commands, so a new package needs no build configuration and cannot fall out of step. A package that does carry a `scripts` block silently opts itself back out: nx loads workspace plugins before its built-in `package-json` inference and the built-in wins the merge, so a script shadows the derived target of the same name.

### Why the tool runs directly

Targets use `nx:run-commands`, not the `nx:run-script` executor nx infers from package.json `scripts`. `run-script` spawns `npm run <script>` per task, and under parallelism an npm startup intermittently aborts inside npm's own config loader (`Exit prior to config file resolving`), failing the task before the tool runs — [#323](https://github.com/laazyj/composureCDK/issues/323), and [npm/cli#8425](https://github.com/npm/cli/issues/8425) upstream, closed _not planned_.

One npm call remains, inside a tool rather than the runner: `attw --pack .` shells out to `npm pack`, so `check:exports` still starts an npm process per package.

### Why commands and scheduling live apart

The plugin supplies only the command. `dependsOn`, `cache`, `inputs` and `outputs` stay in `targetDefaults` in [`nx.json`](../nx.json), because that keeps caching policy next to the `namedInputs` it is written against, and because it also governs the `workspace-root` project in [`project.json`](../project.json), which the plugin does not create.

A target genuinely unique to one package belongs in that package's own `project.json` rather than behind a conditional in the plugin. [`packages/examples/project.json`](../packages/examples/project.json) is the only one: `cdk`, `synth`, `deploy` and `validate` drive the CDK CLI against the example app.

## Root gates and the single entry point

Every gate is an nx target, so `npx nx <target>` is the one way to run anything and `npx nx verify` is the whole gate. The husky `pre-push` hook and every CI step go through it.

The root `package.json` keeps five scripts anyway — `build`, `test`, `lint`, `format`, `verify` — plus `prepare`, which npm's lifecycle requires. They exist for familiarity: `npm test` and `npm run build` are what a first-time contributor, an IDE task list or a generic CI template reaches for first, and having them cost nothing is better than having them be wrong. Each is a single verbatim forward:

```json
"build": "nx run-many -t build",
"test": "nx run-many -t test",
"lint": "nx run-many -t lint",
"format": "nx prettier:write",
"verify": "nx verify"
```

The rule that keeps this from becoming two entry points again is that **a root script may add no configuration** — no flags, no `&&` chains, no logic. That is the line the old `verify` crossed: it chained thirteen gates with `&&`, which made it the only definition of what the gate was, invisible to the graph. A forwarder cannot drift, because there is nothing in it to drift.

They stay out of the graph because the root manifest sets `"nx": { "includedScripts": [] }`. Without that, nx would infer a target from each one and run it through `npm run` — the wrapping [#323](https://github.com/laazyj/composureCDK/issues/323) was about, and `build` would recurse into itself.

`format` forwards to `prettier:write` rather than a same-named target because `nx format` is a built-in nx command; see below.

The workspace-wide gates — `prettier:check`, `actionlint`, `ci:covers-verify`, `catalogue:check`, `licenses:check`, `cdk-floors:check`, `cdk-flags:check` and their write-side siblings — are targets on the `workspace-root` project in [`project.json`](../project.json). They were npm scripts, which made them invisible to the graph: they could not be scheduled against the packages' work, and `verify` had to chain them by hand with `&&`, spawning an npm process per gate. As one graph the cold gate drops from ~123s to ~102s and the warm one from ~10.3s to ~4.6s.

Three things about that file are deliberate:

**They are all `cache: false`.** Measured directly, every one of them is sub-second — `catalogue:check` and `licenses:check` are 30ms each; only `prettier:check` (~4s) is not trivial, and its inputs are every tracked file, so its cache could never hit. nx's own overhead on a cache hit exceeds the work, which is the argument [`ci.md`](ci.md#linting-the-workflows) already made for `actionlint`. Declaring `inputs` for an uncached target buys nothing and is a live hazard: an input list that misses a file the script reads turns into a stale pass the moment someone adds `cache: true`.

**Their scheduling is inline rather than in `targetDefaults`.** That is the one exception to the rule above, and it is because these targets are singletons — a `targetDefaults` entry per gate would be a worse version of the same thing.

**They are named `prettier:check` / `prettier:write`, not `format:check` / `format`.** `nx format` and `nx format:check` are built-in nx commands, and the builtin wins: with the targets named that way, `npx nx format:check` silently ran nx's own affected-files check and exited 0 without checking anything.

One consequence of routing everything through nx: **a gate can only be invoked as an nx target where `node_modules` exists.** Two CI jobs deliberately run without installing — `cdk-floors-enforce`, whose script does its own floor-pinned install and needs the clean checkout, and `release-notify`, which has no dependencies at all and drives the preinstalled `gh`. Both call `node scripts/…` directly, and say why inline. The nx target still exists for everyone else.

`verify` is an `nx:noop` target whose `dependsOn` lists every gate. It is one unordered graph, so the old cheap-gates-first fail-fast is gone; the pre-push hook passes `--nxBail` to stop at the first failure, and CI keeps one step per gate, which is where ordering now lives. `scripts/ci-covers-verify.mjs` reads that `dependsOn` and fails if a gate has no CI step.

## Inputs are only ever tracked files

nx hashes tracked files, so a glob that matches only gitignored paths matches nothing. `{projectRoot}/dist/**/*` is such a glob — it contributes zero files to a hash, which makes it look like coverage it is not. Declare `production` (or `src/**`) instead and let `dependsOn` handle ordering; `dependsOn` does not feed the hash either.

`check:exports` and `validate` were both declared that way, and both replayed cached passes against a `dist` they had never seen: a change under `src/` rebuilt the package and `attw`/`publint` reported success from cache. They now take `production`, plus the external dependencies whose versions decide the verdict.

## Lint

`nx run-many -t lint` caches per project, so unchanged packages fast-succeed. These make that correct rather than merely fast.

**Loose top-level files** (`eslint.config.mjs`, `scripts/**`, `tools/**`, `vitest.config.base.ts`) belong to no package, so the `workspace-root` project in the root [`project.json`](../project.json) lints them. A plain `.mjs` module there also needs a line in `eslint.config.mjs` — both in `allowDefaultProject` and in the `disableTypeChecked` block, since these are untyped node modules; without the second, type-aware rules fire on inferred `any` and the file cannot lint clean.

**The custom rules** in `@composurecdk/eslint-plugin` drive every package's lint result, so `targetDefaults.lint` both depends on that package's `build` (the flat config imports its compiled output) and lists its `src/**` as a lint input, so a rule change busts the dependent lint caches.

**Dependencies are built first.** Type-aware rules resolve other `@composurecdk/*` packages through their built `dist/` types, so `lint` depends on `^build`, as `typecheck` and `test` do. Without it, lint in the same run can read a dependency's `dist/` before or while it is built, and fail on unresolved `any`.

**Not the `@nx/eslint` inference plugin.** It infers the same `lint` targets, but it evaluates the root flat config during graph construction to skip projects with no lintable files. That imports `@composurecdk/eslint-plugin` before it is built, so every nx command fails on a fresh checkout. Our plugin reads only file names, so the config is not loaded until lint actually runs — by which point `dependsOn` has built the plugin.

**tshy's intermediates are ignored.** `.tshy/` and `.tshy-build/` are gitignored, and eslint ignores them too: a `lint` task running alongside that package's `build` otherwise walks into generated files no tsconfig covers and fails on them.

## What counts as an input

`namedInputs` in [`nx.json`](../nx.json) sets this. `production` is `default` minus `test/**`, `README.md` and `vitest.config.ts` — the files that cannot change a package's `dist/`. `build` takes `["production", "^production"]`; `typecheck`, `test` and `lint` take `["default", "^production"]`, because a package's own tests do affect its typecheck and test run while a _dependency's_ never do.

Without that split, `default` falls back to nx's built-in `{projectRoot}/**/*` and a one-line edit to any test file re-runs `build`, `typecheck` and `lint` for every dependent — measured at 71 of 75 tasks for a comment appended to `packages/core/test/testing.test.ts`.

Two things to know if you change it:

- **`sharedGlobals` must stay declared.** nx provides it built-in, but defining your own `default` that references it makes it your responsibility; drop it and every nx command fails with `"sharedGlobals" is an invalid fileset`.
- **The exclusion list is short because the tree is tidy.** `dist`, `coverage`, `.tshy` and `cdk.out` are gitignored and nx only hashes tracked files, so they are already out. `package.json` must stay in `production` — tshy reads its build config from there.

**The Node version is part of every hash.** `sharedGlobals` carries a `{ "runtime": "node --version" }` input, so no task result can be replayed across Node majors. Without it a restored cache would let one matrix leg replay another's results and report success without running anything, which is the whole point of the matrix — see [CI](ci.md#nx-task-cache).

## Installing dependencies

Use `npx -y npm@11 ci`. npm refuses to install under npm 10, which Node 22 ships, and the root `package.json` declares `"engines": { "npm": ">=11" }`. Do not `npm install -g npm@11` instead: in agent sandboxes the self-upgrade fails with `Cannot find module 'promise-retry'`. In Claude Code on the web, the SessionStart hook in [`.claude/hooks/session-start.sh`](../.claude/hooks/session-start.sh) runs the install and puts shellcheck on `PATH` in the background.
