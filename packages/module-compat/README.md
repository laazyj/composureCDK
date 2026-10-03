# @composurecdk/module-compat

Executable consumption tests for the dual ESM/CJS publishing standard ([ADR-0007](../../docs/adr/0007-dual-esm-cjs-publishing.md)).

Every `@composurecdk/*` package ships both an ESM and a CommonJS build. These
tests guard that contract from the consumer's side, by spawning a fresh `node`
process per case:

- **Resolution** — each package is loaded under both `require()` (CommonJS) and
  `import` (ESM), asserting it resolves and its exports are present.
- **`cdk synth`** — a tiny CDK app runs `compose(...).build(app, id)` +
  `app.synth()` under both a `"type": "commonjs"` and a `"type": "module"`
  package, exercising the real `cdk synth` path from issue #119.

This is a private, unpublished workspace package — it exists only to run in CI
and `npx nx verify`.

## Layout

- `checks.mjs` — the checks themselves, in plain Node so they run on every
  supported Node without the dev toolchain. Every `@composurecdk/*` package in
  `peerDependencies` must load under `require()` and `import` with named
  exports, and each fixture app must exit 0.
- `check.mjs` — the command line over `checks.mjs` that CI runs; it prints the
  results and exits non-zero on a failure.
- `test/fixtures/{cjs,esm,dual-realm}/` — the fixture apps: a CommonJS synth,
  an ESM synth, and both module systems in one process. Each directory has its
  own `package.json` `type` marker.
- `test/check.test.ts` — imports `checks.mjs` (so its code is measured by
  coverage) and runs it against the workspace build, proves a failing fixture
  (`test/fixtures/failing/`) is reported, and checks `check.mjs` exits non-zero
  on one.

A new package needs adding to `peerDependencies`; `npx nx consumer:pack` fails
if a published package is missing.

## Running

```sh
npx nx test module-compat   # against the workspace build, on your Node
npx nx consumer:check       # build, pack, install the tarballs, then check.mjs
```

CI runs the second on every supported Node; see
[consumer compatibility](../../docs/ci.md#consumer-compatibility).
