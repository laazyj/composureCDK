# ADR 0006: Decorator pattern for cross-cutting builder features

- **Status:** Accepted
- **Date:** 2026-05-07

## Context

`@composurecdk/core` exports `Builder<Props, T>(constructor)` and the `IBuilder<Props, T>` mapped type — a deliberately minimal, CDK-agnostic builder primitive. Every builder package in the library uses it directly. [ADR-0005](0005-builder-copy.md) added `.copy()` to that primitive for variant authoring and strategy hand-off; any cross-cutting extension must compose with it.

Some features apply to **every** builder rather than to one resource type — tagging is the first; structured logging hooks, dry-run modes, and removal-policy defaults are plausible follow-ups. Three implementation paths surfaced when designing the tagging surface (issue #66):

1. **Per-builder methods.** Each builder class declares its own `.tag()` / `.tags()` and applies them in `build()`. ~10 lines × ~30 builders, with drift risk on every change.
2. **Modify `core.Builder()`** to special-case the cross-cutting method names. Eliminates duplication but couples `core` to `aws-cdk-lib` and grows with each new feature.
3. **A decorator factory wrapping `Builder()`.** A new factory in a CDK-aware package returns a Proxy that intercepts the cross-cutting methods and delegates everything else to the inner core proxy.

## Decision

**Cross-cutting builder features are added via decorator factories that wrap `Builder()`. Each library builder factory opts in by calling the decorator instead of bare `Builder()`. `core` stays minimal.**

Shape:

- **Naming.** A decorator is `<feature>Builder<Props, T>(constructor)` (e.g. `taggedBuilder`) with a paired type alias `I<Feature>Builder<Props, T>`. Both live in the package most natural for the feature — `@composurecdk/cloudformation` for CDK-aware features.
- **Type.** `I<Feature>Builder<Props, T>` re-derives `IBuilder<Props, T>`'s mapped pieces but rewrites every chainable return position to `I<Feature>Builder<Props, T>`, so the decorator's added methods stay reachable after any chained call.
- **Runtime.** The decorator returns an outer Proxy wrapping the inner `Builder()` Proxy. The outer intercepts the feature's method names, wraps `build()` to apply the feature, intercepts `.copy()` to clone the decorator's own state and re-wrap the inner copy, and re-wraps any other inner-returning methods so the chain returns the outer Proxy.
- **Opt-in.** Each builder factory chooses bare `Builder()` or a decorator. ESLint can enforce a default for library code (see [ADR-0001 lint precedent](0001-builder-type-emission.md)).

For `taggedBuilder`'s implementation specifics, see the [Tagging section of `extensions.md`](../extensions.md#tagging).

## Composing with `.copy()`

[ADR-0005](0005-builder-copy.md) introduces `.copy()` on `IBuilder`. A decorator must intercept it explicitly: without an interception, `outer.copy()` would surface the bare inner Proxy returned by core, silently dropping both the decorator's added methods and any build-time hooks the decorator installs.

The interception pattern is:

1. Call `inner.copy()` to obtain a new inner Proxy with cloned `props` (and any class-implemented `[COPY_STATE]` state).
2. Clone the decorator's own per-instance state (e.g. the tag accumulator) so the copy and the original mutate independently.
3. Re-wrap the new inner with a fresh outer Proxy, returning a same-shaped tagged builder.

Class-level `[COPY_STATE]` from core handles state stored on the wrapped class. Decorator-level state (state stored in the decorator's closure) is invisible to the class and must be cloned by the decorator's own `.copy()` interception.

## Stacking decorators

The runtime stacks cleanly: a second decorator wraps `taggedBuilder(C)` the same way `taggedBuilder` wraps `Builder(C)`. The proxy chain forwards unintercepted access through to the next layer.

The type system does not. TypeScript imposes three constraints that together prevent decorators from sharing the mapped-type computation:

- `this`-types are only legal in classes and interfaces, not in type aliases — so `tag(...): this` is not expressible on `ITaggedBuilder`.
- Interfaces cannot `extend` mapped types — so a stacked decorator cannot inherit `ITaggedBuilder`'s mapped pieces.
- Type aliases cannot self-reference through a generic helper — so a `ChainableShape<P, T, Self>` extracted helper, with each decorator pinning `Self` to itself, fails as circular.

The practical consequence: **each decorator that wants chainability declares its own complete mapped-type alias**, with its own name in every chainable return position. A stacked decorator does not extend or intersect the inner decorator's type — it restates the chainable shape and lists every method from every decorator it includes.

```ts
// ITaggedBuilder<P, T> — chainable returns are ITaggedBuilder
// IBarBuilder<P, T>    — chainable returns are IBarBuilder, has .bar()
// IFooBuilder<P, T>    — chainable returns are IFooBuilder, lists .tag/.tags/.bar/.foo
```

Cost per decorator: two mapped-type blocks (~6 lines) plus an explicit list of every method any included decorator contributes. The cost grows linearly with included methods, not with stack depth — but it does grow.

This shape is workable for a small number of decorators. If the library accumulates more than a handful, the replication will justify either codegen or a different approach (e.g. a class-based builder primitive that supports `this`-types). That rethink is out of scope for this ADR; it is a known future cost, not a present problem.

## Consequences

- `@composurecdk/core` stays minimal. `Builder()` and `IBuilder<Props, T>` remain free of CDK dependencies.
- Cross-cutting features ship in CDK-aware packages and are consumed by every builder package as a peer dependency. Existing dependency direction (builder packages → CDK-aware packages → `core`) is preserved.
- Adding a new cross-cutting feature is a single-package change plus a one-line factory swap per builder. No per-builder method boilerplate.
- A lint rule can guarantee library builders pick up the decorator by default. Custom builders authored outside the library can use bare `Builder()` directly.
- Decorators must explicitly intercept `.copy()` to preserve their wrapping and clone their own per-instance state — a forgotten interception silently drops the decorator's surface from the copy.
- Stacking multiple decorators is supported but not free: each new decorator restates the chainable mapped pieces and lists every method it includes. Acceptable up to a handful; revisit beyond.
- Each builder package gains a peer dependency on the package hosting the decorator (`@composurecdk/cloudformation` for `taggedBuilder`). A dedicated `@composurecdk/builder` package was considered but rejected for now — the only decorator today is tightly coupled to `Tags.of` from `aws-cdk-lib`, which `cloudformation` already depends on. Revisit if decorators land in additional domain packages.

## Alternatives considered

- **Modify `core.Builder()` to special-case cross-cutting method names.** Rejected: couples `core` to `aws-cdk-lib` and grows the proxy with feature-specific code.
- **Per-builder `.tag()` / `.tags()` methods on each class.** Rejected: ~300 lines of duplicated mechanics with drift risk on every change.
- **A mixin or base class.** Rejected: the library uses interfaces, not inheritance ([architecture.md](../architecture.md)). A base class would force builders to extend a framework class.
- **Aspect-based application without a builder-level surface.** Rejected for tagging: authors need a place to write the tag declaration that sits next to the resource it targets. Aspects remain the right tool for system-wide concerns; `tags({ system: {...} })` covers that case via an `afterBuild` hook.
