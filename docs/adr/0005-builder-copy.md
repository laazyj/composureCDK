# ADR 0005: `.copy()` on Builder for variant authoring and strategy hand-off

- **Status:** Accepted
- **Date:** 2026-05-07

## Context

Two recurring needs sit on top of the fluent builder pattern in `@composurecdk/core`:

1. **Variant authoring.** Users want to derive multiple configured variants from a shared base — for example, a `StackBuilder` configured with common tags, then specialized per region. Today they have to re-state the base configuration at each call site or factor it into a helper that returns a fresh builder.

2. **Strategy hand-off snapshot.** Stack strategies in `@composurecdk/cloudformation` (`singleStack`, `groupedStacks`) call `builder.build(scope, id)` lazily during compose-build. If the user mutates the builder between hand-off and the deferred build, those mutations leak into the strategy's stack. Issue #78 surfaced this footgun while reshaping the strategies to consume builders directly instead of `ScopeFactory`s.

A previous proposal (issue #78 as originally written) resolved the second need with a `freeze()` primitive that returned an immutable snapshot. `freeze()` solves only the hand-off case, requires mutation-guard machinery on every setter, and forces a throw-vs-no-op decision for setters on a frozen builder.

## Decision

`core/Builder()` exposes `.copy(): IBuilder<Props, T>` as a built-in proxy property. The default implementation:

1. Allocates a fresh instance via the captured constructor.
2. Shallow-clones `props` (`{ ...target.props }`).
3. Calls an optional `[COPY_STATE](target)` hook on the underlying class so it can copy non-`props` state (private fields, internal accumulators).
4. Wraps the new instance in a fresh proxy via `Builder(constructor, instance)` and returns it.

`COPY_STATE` is a `Symbol.for(...)` key. Symbols pass through the existing `typeof prop === "symbol"` branch in the proxy, so the hook is invisible to the fluent API and to IDE autocomplete.

`Builder()` accepts an optional second parameter, `instance: T = new constructor()`, used by `.copy()` (and any future caller) to wrap a pre-built instance without re-running the constructor for default state.

`.copy()` is added to the `IBuilder` mapped type so it is discoverable in TS autocomplete on every builder.

### Decorator-builder protocol

Decorators that wrap `Builder()` and hold state on an outer proxy (for example a tag accumulator) **must override `.copy()` in that outer proxy**: clone the decorator's own state, chain to the inner `.copy()`, and re-wrap. The `[COPY_STATE]` hook only reaches the inner instance; it cannot see decorator-layer state. The protocol is part of the public contract for any future decorator pattern in this library.

### Shallow vs deep clone of `props`

`props` is shallow-cloned. Top-level keys are independent between original and copy; nested CDK references (VPCs, IRoles, etc.) are shared by design — these are construct identities, not configuration data. This matches the existing single-spread merge pattern (`{ ...DEFAULTS, ...this.props }`) used throughout the library. Builders with internal lists/maps/sets that should be deep-cloned implement `[COPY_STATE]`.

## Alternatives considered

- **`.freeze()` returning an immutable snapshot** (the original proposal in #78). Rejected: solves only the strategy hand-off problem, not variant authoring. Requires mutation guards on every setter and a throw-vs-no-op decision. `.copy()` covers the same hand-off case via the inline `singleStack(builder.copy())` idiom and additionally unlocks variant authoring with strictly less machinery.
- **`.copy()` per-builder rather than in core.** Each builder class implements its own `.copy()`. Rejected: every builder would need the same proxy-rewrap dance; consumers would face an inconsistent surface (some builders have `.copy()`, others don't); the public contract for variant authoring would not be discoverable in `IBuilder`.
- **Deep-clone `props` (e.g., via `structuredClone`).** Rejected: CDK construct references in props (VPC, IRole, ISecurityGroup) are not cloneable and shouldn't be — they are identities. Shallow clone matches the existing merge pattern and keeps construct identity stable across copies.
- **Named-method hook (`copyStateInto`) instead of a Symbol.** Rejected: a named method either pollutes the public surface (showing up on every builder's autocomplete) or requires special-casing in the proxy's `methods` set. The Symbol passes cleanly through `Reflect.get`.

## Consequences

- Every builder gets `.copy()` for free without per-class boilerplate.
- Builders with non-`props` state (StackBuilder's `#tags`; future decorator accumulators) opt in via `[COPY_STATE]` or, for decorator layers, by overriding `.copy()` in their proxy. The protocol is part of the public builder contract going forward.
- The strategy reshape in #78 documents `singleStack(builder.copy())` as the snapshot-handoff idiom. The library does not enforce it at runtime; passing a live builder is permitted and useful when no further mutation occurs.
- Shallow-clone semantics are part of the API. Documented in [architecture.md](../architecture.md#copying-a-builder) and JSDoc on `IBuilder.copy`.
- `Builder()` now accepts an optional `instance` parameter. This is implementation infrastructure for `.copy()`; library consumers should continue to call `Builder(constructor)` with one argument unless they have a specific reason to wrap a pre-built instance.
