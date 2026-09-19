# @composurecdk/eslint-plugin

Internal ESLint plugin encoding ComposureCDK architectural invariants — tagged builders, lifecycle context, builder copy state.

Not yet published (`"private": true`), but held to the same packaging bar as the published `@composurecdk/*` packages: it ships a dual ESM/CommonJS build produced by `tshy`, its `exports` map is generated rather than hand-written, and `check:exports` (`attw` + `publint`) and the `@composurecdk/module-compat` resolution suite gate it on every `npm run verify`. See [ADR-0007](../../docs/adr/0007-dual-esm-cjs-publishing.md#amendment-2026-09-18-eslint-plugin-joins-the-standard).

## Usage

`configs.recommended` is a self-contained flat config entry — it registers the plugin, so extending it is all that is needed:

```js
import composurecdk from "@composurecdk/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    extends: [composurecdk.configs.recommended],
  },
];
```

From a CommonJS flat config the `require()` result is itself the plugin — `rules` and `configs` are own properties of it, so no `.default` unwrapping is needed:

```js
const composurecdk = require("@composurecdk/eslint-plugin");

module.exports = [
  {
    files: ["src/**/*.ts"],
    extends: [composurecdk.configs.recommended],
  },
];
```

### Scoping is yours

The preset declares no `files`. The rules are written for **library source** — applying them unscoped will flag test, fixture and config code — but only you know where your source lives, so pick the glob as above. (This repo uses `packages/*/src/**/*.ts`.)

File-level overrides (e.g. disabling a rule on a specific file) likewise belong in your config, not in the preset.

### Picking rules individually

`configs.recommended.rules` is still a plain severity map, so you can register the plugin yourself and take a subset:

```js
import composurecdk from "@composurecdk/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    plugins: { composurecdk },
    rules: { "composurecdk/builder-must-be-tagged": "error" },
  },
];
```

Mixing the two forms is safe: the preset registers the same plugin object this `plugins` entry does, so ESLint sees one plugin rather than a conflicting redefinition.

## Rules

Each rule has a documentation page with its rationale, examples, deliberate exclusions and known gaps. `meta.docs.url` points at it, so an editor can open it straight from a reported violation.

| Rule                                                                                                      | What it flags                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`composurecdk/builder-must-be-tagged`](docs/rules/builder-must-be-tagged.md)                             | `Builder` / `IBuilder` from `@composurecdk/core` in a library builder — use the tagged equivalents.                  |
| [`composurecdk/builder-must-implement-copy-state`](docs/rules/builder-must-implement-copy-state.md)       | A builder class holding private state with no `[COPY_STATE]` hook, so `.copy()` silently drops it.                   |
| [`composurecdk/constraint-metadata-required`](docs/rules/constraint-metadata-required.md)                 | A `stringConstraint({ … })` call with an empty `name`, `allowed` or `source`, degrading every error it produces.     |
| [`composurecdk/lifecycle-build-context-required`](docs/rules/lifecycle-build-context-required.md)         | `Lifecycle.build()` missing the `context` param when the class uses `Resolvable<…>`.                                 |
| [`composurecdk/lifecycle-build-must-forward-context`](docs/rules/lifecycle-build-must-forward-context.md) | A two-argument `builder.build(scope, id)` — the sub-builder gets no context, so refs cannot resolve.                 |
| [`composurecdk/no-cdk-api-above-floor`](docs/rules/no-cdk-api-above-floor.md)                             | `aws-cdk-lib` APIs newer than the supported peer floor — they throw on older versions in the range.                  |
| [`composurecdk/no-cjs-incompatible-syntax`](docs/rules/no-cjs-incompatible-syntax.md)                     | `import.meta` / top-level `await` in library `src/` — neither emits to CommonJS.                                     |
| [`composurecdk/no-realm-bound-instanceof`](docs/rules/no-realm-bound-instanceof.md)                       | `instanceof` against an imported class — realm-bound, so it silently returns false across the dual-package boundary. |
| [`composurecdk/redeclared-prop-must-track-cdk-type`](docs/rules/redeclared-prop-must-track-cdk-type.md)   | A prop re-declared out of an `Omit<CdkProps, …>` that pins a CDK interface instead of reading CDK's own prop type.   |

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
3. Add it to `recommendedRules` in `src/configs/recommended.ts` at its intended severity.
4. Write `docs/rules/<kebab-name>.md`, leading with `# composurecdk/<kebab-name>`. This is where rationale, examples, deliberate exclusions and known gaps live — the rule's own source comment stays a summary plus a link. `meta.docs.url` is derived from the name you registered, so there is nothing to wire up.
5. Add a row to the table above, linking the page.
6. Write `test/rules/<kebab-name>.test.ts` using `RuleTester` (see existing tests). Cover at least one valid and one invalid case per `messageId`.

Steps 3–5 are each asserted by `test/docs.test.ts` and `test/configs/recommended.test.ts` — skip one and the suite fails rather than the omission going unnoticed.

## Running tests

```sh
npx nx test eslint-plugin
```

Tests use Vitest as the runner with ESLint's `RuleTester` driving fixtures. The shared `RuleTester` instance (configured with the typescript-eslint parser) lives in `test/rule-tester.ts`.
