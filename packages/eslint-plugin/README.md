# @composurecdk/eslint-plugin

Internal ESLint plugin encoding ComposureCDK architectural invariants — tagged builders, lifecycle context, builder copy state.

Not yet published (`"private": true`), but held to the same packaging bar as the published `@composurecdk/*` packages: it ships a dual ESM/CommonJS build produced by `tshy`, its `exports` map is generated rather than hand-written, and `check:exports` (`attw` + `publint`) and the `@composurecdk/module-compat` resolution suite gate it on every `npm run verify`. See [ADR-0007](../../docs/adr/0007-dual-esm-cjs-publishing.md#amendment-2026-09-18-eslint-plugin-joins-the-standard).

## Usage

The root `eslint.config.mjs` consumes the plugin via the `recommended` preset:

```js
import composurecdk from "@composurecdk/eslint-plugin";

export default [
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: { composurecdk },
    rules: composurecdk.configs.recommended.rules,
  },
];
```

From a CommonJS flat config the `require()` result is itself the plugin — `rules` and `configs` are own properties of it, so no `.default` unwrapping is needed:

```js
const composurecdk = require("@composurecdk/eslint-plugin");

module.exports = [
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: { composurecdk },
    rules: composurecdk.configs.recommended.rules,
  },
];
```

File-level overrides (e.g. disabling a rule on a specific file) belong in the consumer config, not in the preset.

## Rules

| Rule                                                | What it flags                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composurecdk/builder-must-be-tagged`               | `Builder` / `IBuilder` from `@composurecdk/core` in library builders (use `taggedBuilder`).                                                                         |
| `composurecdk/builder-must-implement-copy-state`    | Builder classes with private fields but no `[COPY_STATE]` hook (see ADR-0005).                                                                                      |
| `composurecdk/lifecycle-build-context-required`     | `Lifecycle.build()` missing the `context` param when the class uses `Resolvable<…>`.                                                                                |
| `composurecdk/lifecycle-build-must-forward-context` | A two-argument `builder.build(scope, id)` call — the sub-builder gets no context, so refs passed through a `configure` callback cannot resolve.                     |
| `composurecdk/no-cdk-api-above-floor`               | `aws-cdk-lib` APIs newer than the supported peer floor (e.g. the per-resource `isCfn<Resource>` L1 static guards) — they throw on older versions in the peer range. |
| `composurecdk/no-cjs-incompatible-syntax`           | `import.meta` / top-level `await` in library `src/` — neither emits to CommonJS (ADR-0007).                                                                         |
| `composurecdk/no-realm-bound-instanceof`            | `instanceof` against an imported class in library `src/` — realm-bound, so it silently returns false across the dual-package boundary (ADR-0007).                   |
| `composurecdk/redeclared-prop-must-track-cdk-type`  | A prop re-declared out of an `Omit<CdkProps, …>` that pins a named CDK interface inside `Resolvable<…>` instead of reading CDK's own prop type (ADR-0018).          |

The `recommended` preset also bans the TypeScript `private` modifier via `no-restricted-syntax` (use ECMAScript `#field` instead — TS `private` leaks through `keyof T` into emitted `.d.ts`, producing TS4094 downstream).

## Adding a new rule

1. Create `src/rules/<kebab-name>.ts`:

   ```ts
   import type { Rule } from "eslint";

   export const rule: Rule.RuleModule = {
     meta: {
       type: "problem",
       docs: { description: "..." },
       schema: [],
       messages: { someId: "..." },
     },
     create(ctx) {
       return {/* visitor */};
     },
   };
   ```

2. Register it in `src/rules/index.ts`.
3. Add it to `src/configs/recommended.ts` at its intended severity.
4. Write `test/rules/<kebab-name>.test.ts` using `RuleTester` (see existing tests). Cover at least one valid and one invalid case per `messageId`.

## Running tests

```sh
npx nx test eslint-plugin
```

Tests use Vitest as the runner with ESLint's `RuleTester` driving fixtures. The shared `RuleTester` instance (configured with the typescript-eslint parser) lives in `test/rule-tester.ts`.
