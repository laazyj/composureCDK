# ADR 0020: `scoped()` — build a composed system under a construct of its own

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

`compose()` derives each component's construct id as `` `${id}/${key}` `` ([ADR-0012](0012-explicit-build-id-decoupled-from-compose-key.md)). The `/` reads like nesting, but `constructs` rewrites it to `--`. A nested system therefore never gets a node of its own. Its components land beside the parent's as siblings with long names:

```
Stack/App--orders
Stack/App--failures--bucket
Stack/App--failures--queue
```

A composite, meaning an L3 that builds its parts with `compose()`, cannot keep those parts together. The tree is a flat list, and `Tags.of()` or an Aspect cannot target the composite alone (laazyj/composureCDK#644). Building into `new Construct(scope, id)` by hand repeats the id (`App--failures/App--failures--bucket`). Pinning every part with `at()` repeats every key, and a part that misses its `at()` is silently named wrong.

The issue proposed making an empty build id mean "no prefix". We rejected that. `constructs` throws on an empty id for any construct with a scope, so `""` is not an id. The value also reaches more than id derivation: `singleStack` would create `new Stack(scope, "")` and throw, and `afterBuild` hooks would receive it. And it splits one intent into two steps that the author must remember to pair.

## Decision

**`scoped(system)` wraps a system returned by `compose()` in a `Lifecycle` that creates `new Construct(scope, id)` and builds the system into it, with each component's id equal to its key.**

```ts
scoped(compose({ bucket, queue }, deps)).build(scope, "App--failures");
// App--failures/bucket
// App--failures/queue
```

- **`id` stays a real construct id.** It names the new construct, the one thing in the tree that represents the system. Stack strategies receive the new construct and `id` as their parent scope and system id. `afterBuild` hooks on the wrapped system receive the new construct, so `tags()` there reaches the system's resources only.
- **Key-only ids apply only inside the new construct.** A component routed elsewhere by `withStacks` or a strategy keeps `` `${id}/${key}` ``, because the new construct does not namespace it there. An `at()`-pinned id still wins, and the per-scope duplicate-id guard is unchanged.
- **It accepts only what `compose()` returns.** The key-only build is a `Symbol.for`-keyed method on `compose()`'s systems ([ADR-0007](0007-dual-esm-cjs-publishing.md)). It is not exported, so `Lifecycle.build`'s signature does not change. `scoped` throws a `TypeError` for anything else.
- **It is a function, not a method.** Like `at()`, it sits where the component is declared and adds no interface surface. A consumer can also apply it to a sealed system it did not write.

## Consequences

- **A composite encapsulates its resources in one call.** It returns `scoped(compose(...)).build(scope, id, context)` from its `build`, and needs no `at()` per part.
- **Derived ids stay as they were.** Unwrapped systems build exactly as before. Wrapping an already-deployed system changes its construct paths and so replaces its resources. That is opt-in, and the README says so.
- **Default alarm names follow the new path.** They include the constructs between the stack and the builder's scope (#700), so an alarm inside a scoped system is named `<stack>/<system>/<key>/<alarm>`.
- **`componentScopes` still names the scope each component was built into.** For a scoped component in a parent `compose()`, that is the parent's scope, not the new construct. A hook that should reach the subtree alone goes on the wrapped system.

## Alternatives considered

- **Empty build id means "no prefix"**, as proposed in #644. Rejected for the reasons in Context.
- **A chained `.nested()` method on `ComposedSystem`**, a peer of `withStacks`. Easier to discover, but it adds surface to two interfaces and is mutually exclusive with stack routing. Only the system's author could apply it.
- **A `compose()` option such as `{ ids: "key" }`.** Names the mode, but leaves creating the construct as a separate manual step. Forgetting that step puts plain keys beside the consumer's own components, outside the reach of the duplicate guard. It also points towards pluggable id derivation, which ADR-0012 rejected.
