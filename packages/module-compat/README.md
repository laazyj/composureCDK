# @composurecdk/module-compat

Executable consumption tests that guard the published `@composurecdk/*`
packages from the consumer's side — both the dual ESM/CJS publishing standard
([ADR-0007](../../docs/adr/0007-dual-esm-cjs-publishing.md)) and the declared
`aws-cdk-lib` peer range.

- **Resolution** — each package is loaded under both `require()` (CommonJS) and
  `import` (ESM) in a fresh `node`, asserting it resolves and its exports are
  present.
- **`cdk synth`** — a tiny CDK app runs `compose(...).build(app, id)` +
  `app.synth()` under both a `"type": "commonjs"` and a `"type": "module"`
  package, exercising the real `cdk synth` path from issue #119.
- **aws-cdk-lib floor** — exercises the built package against the runtime
  surface of the oldest supported CDK (CI installs only the latest), so APIs
  newer than the declared peer floor can't slip in unnoticed (issue #146).

This is a private, unpublished workspace package — it exists only to run in CI
and `npm run verify`.

## Layout

- `test/dual-packages.ts` — the list of dual-published packages and a probe
  export for each. Each entry needs a matching `peerDependency` in
  `package.json`.
- `test/resolution.test.ts` — spawns `node` per package per module syntax.
- `test/synth.test.ts` — spawns `node` on each `cdk synth` fixture.
- `test/fixtures/{cjs,esm}/` — the CommonJS and ESM CDK-app fixtures, each in a
  directory with its own `package.json` `type` marker.
- `test/cdk-floor-compat.test.ts` — synthesises a built package against a
  simulated pre-2.250 aws-cdk-lib (the version-gated statics removed).

## Running

```sh
npx nx test module-compat
```
