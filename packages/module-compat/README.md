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
and `npm run verify`.

## Layout

- `test/dual-packages.ts` — the list of dual-published packages and a probe
  export for each. Each entry needs a matching `peerDependency` in
  `package.json`.
- `test/resolution.test.ts` — spawns `node` per package per module syntax.
- `test/synth.test.ts` — spawns `node` on each `cdk synth` fixture.
- `test/fixtures/{cjs,esm}/` — the CommonJS and ESM CDK-app fixtures, each in a
  directory with its own `package.json` `type` marker.

## Running

```sh
npx nx test module-compat
```
