# @composurecdk/eslint-plugin

ESLint rules that enforce the ComposureCDK builder contract at author time, so the mistakes that only surface as a synth-time error — a dropped build context, a builder that loses state on `.copy()`, an `instanceof` that is false across the dual-package boundary — are caught in the editor instead.

## Install

```sh
npm install --save-dev @composurecdk/eslint-plugin eslint
```

Requires ESLint 10 (flat config) and Node 20+. The package ships dual ESM/CJS, so both config formats work.

## Usage

Apply the `recommended` preset to the sources that implement builders:

```js
// eslint.config.mjs
import composurecdk from "@composurecdk/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    plugins: { composurecdk },
    rules: composurecdk.configs.recommended.rules,
  },
];
```

```js
// eslint.config.cjs
const composurecdk = require("@composurecdk/eslint-plugin");

module.exports = [
  {
    files: ["src/**/*.ts"],
    plugins: { composurecdk },
    rules: composurecdk.configs.recommended.rules,
  },
];
```

The rules are syntactic — no type information, so no `parserOptions.project` needed. They read TypeScript syntax (private fields, type references, parameter properties), so point ESLint at a TypeScript parser such as `@typescript-eslint/parser`.

Scope the preset to your builder sources rather than the whole project. Application entry points build at the root of an `App` or `Stack`, where there is no enclosing component and so no context to forward, and `lifecycle-build-must-forward-context` fires on every `.build(app, "…")` there. Either exclude those files or turn that rule off for them:

```js
{
  files: ["bin/**/*.ts"],
  rules: { "composurecdk/lifecycle-build-must-forward-context": "off" },
}
```

## Rules

Every rule is `error` in the `recommended` preset.

### `lifecycle-build-context-required`

A `Lifecycle` class whose body mentions `Resolvable<…>` must declare the third `context` parameter on `build()`.

A builder that accepts refs at configuration time needs the context to resolve them at build time. Without the parameter, `resolve(value, context)` gets `undefined` and the ref throws `cannot be resolved`.

```ts
// ✗ accepts refs, but has nowhere to resolve them from
class MyBuilder implements Lifecycle {
  #props: { bucket?: Resolvable<IBucket> } = {};
  build(scope: IConstruct, id: string) {
    /* … */
  }
}

// ✓
class MyBuilder implements Lifecycle {
  #props: { bucket?: Resolvable<IBucket> } = {};
  build(scope: IConstruct, id: string, context?: Record<string, object>) {
    /* … */
  }
}
```

The rule keys on the name `Resolvable` appearing in the class body, which is what makes it cheap and syntactic — and also why it cannot see the case below.

### `lifecycle-build-must-forward-context`

Flags a two-argument `something.build(scope, id)` call: the sub-builder gets no context, so a `ref()` the caller passed through a `configure` callback cannot resolve.

This is the failure that has no local symptom. A _conduit_ builder — one that delegates to sub-builders and holds no `Resolvable` of its own — contains nothing to suggest that context matters, so the declaration rule above stays quiet and the bug surfaces only when someone eventually passes a ref through that seam:

```ts
// ✗ drops `context` — a ref passed through `configure` throws
//   'Ref to "…" cannot be resolved: component not found in context'
build(scope: IConstruct, id: string, context?: Record<string, object>) {
  const logs = createLogGroupBuilder().build(scope, `${id}Logs`);
}

// ✓
build(scope: IConstruct, id: string, context?: Record<string, object>) {
  const logs = createLogGroupBuilder().build(scope, `${id}Logs`, context);
}
```

Thread the context through any helper function in between — that is usually where the dropped argument lives, one call away from the `build()` that owns it.

A root-level build genuinely has nothing to forward. Silence those on the line, naming the reason so the exception stays visible in review:

```ts
// eslint-disable-next-line composurecdk/lifecycle-build-must-forward-context -- root build: nothing composed this stack
stackBuilder.build(app, id);
```

Only calls with exactly two arguments are flagged, which keeps the rule off unrelated `build()` methods with different arities and off spread forwarding (`target.build(...args)`).

### `builder-must-implement-copy-state`

A builder class with ECMAScript private fields must implement the `[COPY_STATE]` hook.

`.copy()` shallow-clones `props`. State held outside `props` needs the hook to reach the clone; without it `.copy()` silently drops it, which breaks variant authoring and strategy hand-off. The rule checks the hook exists, not that it is complete — pair it with `assertCopyPreservesState` from `@composurecdk/core/testing`.

```ts
const createMyBuilder = Builder(
  class MyBuilder {
    #alarms: AlarmSpec[] = [];
    [COPY_STATE](target: MyBuilder) {
      target.#alarms = [...this.#alarms];
    }
  },
);
```

Exempt a field with a justified marker comment — the reason after `--` is required:

```ts
// @copy-state: ignore -- cache, regenerated per build
#synthesized?: Construct;
```

Only classes passed as the first argument to `Builder(…)` or `taggedBuilder(…)` are considered.

### `no-realm-bound-instanceof`

Bans `instanceof` against a class reached through an `import`.

`instanceof` is realm-bound. When both the ESM and CommonJS copy of a package load in one process — the dual-package hazard — each copy has its own class objects, and an instance minted by one fails `instanceof` against the other. The check returns `false` for a value that is plainly of that type, which fails open: a dedup that silently skips, a security guard that never runs.

Brand the class with `Symbol.for(…)` and test for the brand instead. For a CDK construct you cannot modify, identify it by its L1: `CfnResource.isCfnResource(x) && x.cfnResourceType === CfnBucket.CFN_RESOURCE_TYPE_NAME`.

Relative imports are in scope too — `./my-class.js` resolves separately in each copy of the package. Globals (`instanceof Error`) and classes declared in the same module are not flagged, since neither can be duplicated.

Turn this off if you do not dual-publish: in a single-format package or an application, `instanceof` is sound.

### `no-cjs-incompatible-syntax`

Bans `import.meta`, top-level `await`, and top-level `for await…of`.

All three are valid ESM with no CommonJS equivalent, so a dual build fails on the CommonJS pass. Catching them at lint time reports in the editor rather than at the end of a build.

Turn this off if you publish ESM only.

## The `internal` preset

`configs.internal` is the preset ComposureCDK's own repository uses. It adds `builder-must-be-tagged`, `constraint-metadata-required` and `no-cdk-api-above-floor`, plus a `no-restricted-syntax` ban on the TypeScript `private` modifier.

It is exported for transparency, not for adoption: each addition assumes something that is only true inside this repo — `taggedBuilder` from `@composurecdk/cloudformation`, the `stringConstraint(…)` catalogue mechanism ([ADR-0010](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0010-aws-property-constraints.md)), and a hardcoded list of `aws-cdk-lib` APIs above _this repo's_ pinned peer floor ([ADR-0008](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0008-aws-cdk-lib-version-floors.md)), which is the wrong list for a project on a different floor.

The `private`-modifier ban is worth copying if you write builders, and is worth copying rather than inheriting: a preset that sets a core rule replaces whatever you configured for it. TypeScript `private` members appear in `keyof T` and leak into emitted `.d.ts` files via the mapped types builders are made of, producing TS4094 downstream. Use `#field` instead.

## Versioning

Rule names, messages and default severities in `recommended` are public API, so a rule that starts reporting more is a breaking change, not a fix. A new rule therefore ships off by default and joins `recommended` in a minor release.

## Contributing

The plugin lives in the [ComposureCDK monorepo](https://github.com/laazyj/composureCDK). To add a rule:

1. Create `src/rules/<kebab-name>.ts` exporting a `Rule.RuleModule` as `rule`.
2. Register it in `src/rules/index.ts`.
3. Add it to `src/configs/internal.ts`. Add it to `src/configs/recommended.ts` only if the invariant holds outside this repo, and only in a minor release — `test/configs.test.ts` asserts the split, so the decision surfaces as a test change.
4. Write `test/rules/<kebab-name>.test.ts` with `RuleTester`, covering at least one valid and one invalid case per `messageId`.
5. Document it in this README under **Rules** (consumer preset) or **The `internal` preset**.

```sh
npx nx test eslint-plugin
```

Tests run under Vitest with ESLint's `RuleTester` driving the fixtures; the shared tester (configured with the typescript-eslint parser) is in `test/rule-tester.ts`.
