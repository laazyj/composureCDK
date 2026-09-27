# composurecdk/lifecycle-build-must-forward-context

Flags a two-argument `builder.build(scope, id)` call in library source, which gives the sub-builder no context to resolve refs against.

- **Preset:** `libraryAuthor` (`error`)

## Why

This is the call-site counterpart to [`lifecycle-build-context-required`](lifecycle-build-context-required.md), which checks the declaration. Accepting a `context` parameter is not enough: a builder that delegates to a sub-builder must pass its context on. When it does not, the sub-builder resolves refs against `{}`, and any `ref()` the caller supplied through a `configure` callback dies with "component not found in context".

The declaration rule cannot see this. It keys on `Resolvable<` in the builder's own class body, but in every real occurrence the resolvable lived one delegation away — in the _sub-builder's_ props — while the offending call sat in a free helper function (`resolveAccessLogs`, `resolveFlowLogs`, …), often in another file.

Checking the call site catches both failure modes at once: to satisfy the rule at the leaf you must thread `context` into the helper, which in turn forces the parameter onto the parent's `build`.

## ❌ Incorrect

```ts
function resolveAccessLogs(scope: IConstruct, props: Props): Bucket {
  return props.logBucket.build(scope, "LogBucket");
}
```

## ✅ Correct

```ts
function resolveAccessLogs(scope: IConstruct, props: Props, context?: BuildContext): Bucket {
  return props.logBucket.build(scope, "LogBucket", context);
}
```

## Why exactly two arguments

`Lifecycle.build(scope, id, context?)` is always called with at least `scope` and `id`, so a two-argument call is the precise signature of the bug. Matching exactly two — rather than "fewer than three" — keeps the rule off unrelated `build()` methods that share the name, notably `StatementBuilder.build()` in `@composurecdk/iam`, which takes none.

A spread call such as `target.build(...args)` is one argument and is likewise skipped: that is the generic forwarding wrapper in `tagged-builder.ts`, which passes context through by construction.

## Escape hatch

A root-level build genuinely has no context to forward — nothing composed it. Silence those explicitly, so the exception stays visible in review:

```ts
// eslint-disable-next-line composurecdk/lifecycle-build-must-forward-context -- root build: the strategy callback receives only (scope, id)
stackBuilder.build(scope, id);
```

Application entry points build at the root as a matter of course, so this repo's root config switches the rule off for `packages/examples/src`.

## How it works

Deliberately syntactic, like every rule in this plugin. Type information would let it assert the receiver really is a `Lifecycle`, but the residual false-positive set is small and specific — root-level standalone builds, above — so the added cost is not yet worth paying.
