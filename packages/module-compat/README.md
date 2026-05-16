# @composurecdk/module-compat

Executable consumption tests for the dual ESM/CJS publishing standard ([ADR-0007](../../docs/adr/0007-dual-esm-cjs-publishing.md)).

Every `@composurecdk/*` package ships both an ESM and a CommonJS build. These
tests guard that contract from the consumer's side: for each migrated package,
a fresh `node` process is spawned to load it under both `require()` (CommonJS)
and `import` (ESM), asserting the package resolves and its exports are present.

This is a private, unpublished workspace package — it exists only to run in CI
and `npm run verify`.

## Layout

- `test/dual-packages.ts` — the list of dual-published packages and a probe
  export for each. Grows as the tshy rollout proceeds; each entry needs a
  matching `peerDependency` in `package.json`.
- `test/resolution.test.ts` — spawns `node` per package per module syntax.

## Running

```sh
npx nx test module-compat
```
