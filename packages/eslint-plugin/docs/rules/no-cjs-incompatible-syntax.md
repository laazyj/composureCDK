# composurecdk/no-cjs-incompatible-syntax

Flags syntax in library `src/` that has no CommonJS emit: `import.meta`, top-level `await`, and top-level `for await…of`.

- **Preset:** `dualPublishing` (`error`)
- **Decision:** [ADR-0007](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0007-dual-esm-cjs-publishing.md)

## Why

Every `@composurecdk/*` package is dual-published, ESM and CommonJS. All three constructs are valid ESM with no CJS equivalent, so `tsc` — and `tshy`'s CommonJS dialect — errors on them.

Catching them at lint time gives an in-editor error immediately, rather than waiting for the per-dialect compile to fail.

## ❌ Incorrect

```ts
const here = import.meta.url;

const config = await loadConfig();

for await (const chunk of stream) {
  // …
}
```

## ✅ Correct

```ts
import { fileURLToPath } from "node:url";

async function init(): Promise<Config> {
  const config = await loadConfig();
  for await (const chunk of stream) {
    // …
  }
  return config;
}
```

Move the `await` inside an async function. Where a module genuinely needs its own location, take it from a parameter or a caller-supplied value rather than `import.meta`.

## Scope

Library `src/` only. Test files are never published, so they may use all three freely — this repo's root config applies the preset to `packages/*/src/**/*.ts`.

## How it works

Syntactic. `import.meta` is matched as a `MetaProperty`; `await` and `for await…of` are reported only when no enclosing function declaration, function expression or arrow function is found in the ancestor chain — that is, only at the top level.
