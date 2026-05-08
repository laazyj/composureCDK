# @composurecdk/eslint-plugin

Internal ESLint plugin encoding ComposureCDK architectural invariants — tagged builders, lifecycle context, builder copy state. Private to the workspace; not published.

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

File-level overrides (e.g. disabling a rule on a specific file) belong in the consumer config, not in the preset.

## Rules

| Rule                                             | What it flags                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `composurecdk/builder-must-be-tagged`            | `Builder` / `IBuilder` from `@composurecdk/core` in library builders (use `taggedBuilder`). |
| `composurecdk/builder-must-implement-copy-state` | Builder classes with private fields but no `[COPY_STATE]` hook (see ADR-0005).              |
| `composurecdk/lifecycle-build-context-required`  | `Lifecycle.build()` missing the `context` param when the class uses `Resolvable<…>`.        |

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
       return {
         /* visitor */
       };
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
