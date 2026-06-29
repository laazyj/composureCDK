# ADR 0012: Explicit build id — decouple the construct id from the compose key

- **Status:** Accepted
- **Date:** 2026-06-29

## Context

`compose()` derives each component's construct id from its key:

```js
results[key] = this.#components[key].build(componentScope, `${id}/${key}`, context);
```

The key therefore does double duty: it is both the **wiring name** (used in the
dependency map and in `ref()`/context lookups) and the **construct id segment**
(the `id` argument passed to `build`). For most systems that coupling is
convenient. It becomes destructive the moment an already-deployed system is
nested as a component inside a parent `compose()` (laazyj/composureCDK#245).

A system built standalone as `apex.build(app, "jasonduffett.net")` puts a zone
record at `jasonduffett.net/records/aExchange` → logical id
`jasonduffettnetrecordsaExchange264619CE`. Nest that same system under key
`jduffett` and the path becomes `jasonduffett.net/jduffett/records/aExchange` →
a different logical id. CDK hashes the **full construct path string**, so the
inserted `jduffett/` segment rotates _every_ logical id in the nested system —
CloudFormation replaces every resource. There is no combination of parent id +
key that reproduces the original single-segment path.

The motivating case: a live apex site and a brand-new subsite should become two
sub-lifecycles of one `compose()` so a delegation record can `ref()` both zones
instead of using a raw escape hatch. The subsite's ids may change; the apex's
must stay byte-for-byte identical or the refactor replaces the production zone,
distribution, bucket and ~20 DNS records.

A downstream workaround exists — a `Lifecycle` adapter that ignores the id
`compose()` assigns and substitutes a fixed one:

```ts
const withFixedId = (inner, id) => ({ build: (s, _id, ctx) => inner.build(s, id, ctx) });
```

It works, but the `_id` is a tell: the framework computes an id and the
component throws it away. The library should pass the intended id in the first
place rather than force components to discard it.

## Decision

**A component may be tagged with an explicit construct id via `at(id, inner)`.
`compose()` builds a tagged component under that id verbatim, instead of
deriving `` `${parentId}/${key}` ``. The id rides on a `Symbol.for` brand that
only `compose()` reads; the component's wiring key is unaffected.** This
separates the key's two roles — wiring name vs. construct id — and lets a nested
system preserve the logical ids it had standalone.

1. **`at(id, inner)` returns an ordinary `Lifecycle`.** It carries the id on a
   `BUILD_ID = Symbol.for("composurecdk.buildId")` brand and forwards `build`
   straight to `inner`. The brand is realm-agnostic for the same reason as the
   `Ref` brand ([ADR-0007](0007-dual-esm-cjs-publishing.md)): the ESM and
   CommonJS copies of `@composurecdk/core` can both load in one process, so a
   tag minted by either copy must be read by either. The tag is _not_ a
   self-overriding wrapper — it does not discard the id argument.

2. **`compose()` honours the brand through the `id` argument it already passes.**
   `#buildWith` reads the pinned id (falling back to the `${parentId}/${key}`
   derivation) and passes it as the `build` `id`. For a tagged component the
   inner `build` receives and honours it end to end. Nothing is discarded — the
   `id` argument means what it says, which is the property the downstream adapter
   lacked.

3. **The wiring key is untouched.** `at()` changes only the construct id, not the
   key used in the dependency map, topological sort, or `ref()`/context lookups.
   `BuildResult`'s `ReturnType<build>` inference is preserved because the tagged
   value still structurally satisfies `Lifecycle<T>` — the brand is an extra
   symbol property, invisible to the mapped type.

4. **A pinned id is checked for collisions, per scope.** An explicit id re-roots
   into the sibling namespace of the scope it builds into, so it can collide with
   another component's id (its own `${id}/${key}` derivation, or another pin).
   `#buildWith` tracks the ids built into each scope and throws a descriptive
   error on a duplicate, rather than letting it surface as an opaque CDK
   duplicate-construct error deeper in synth. Collisions are scoped: the same
   pinned id in two different stacks (via `withStacks`) is legal.

5. **`at` is the only public surface.** `BUILD_ID` and `buildIdOf` stay internal
   to the package (mirroring the unexported `Ref` brand), so the public API gains
   exactly one function.

## Consequences

- Nesting a deployed system into a parent graph no longer rotates its logical
  ids: `compose({ jduffett: at("jasonduffett.net", apex), clara }, …)` builds
  apex's components at `jasonduffett.net/<key>`, byte-identical to standalone.
  This resolves #245 and unblocks the compose-of-sub-lifecycles refactor that
  motivated it.
- **`at()` subsumes the per-component-map and id-strategy alternatives.** One
  component → `at()`. Several → several `at()` calls at the declaration site. No
  separate `withIds()` method or `withIdStrategy()` hook is added; id control
  lives where the component is declared, next to the `id` argument it sets.
- **The compose key is no longer guaranteed to equal the construct id segment.**
  Readers and tooling that assumed `${parentId}/${key}` must consult the
  effective id. This is the deliberate decoupling; it is the one new invariant
  the ADR introduces.
- A pinned id shares its scope's sibling namespace, so callers own uniqueness.
  The per-scope guard turns a misuse into an early, named error instead of a
  late CDK one, but it does not absolve the caller of choosing non-colliding ids.
- `architecture.md`'s "The result is a Lifecycle" / nesting section is amended
  with a short note on `at()`, since id preservation under nesting is core
  `compose()` behaviour rather than a niche concern.

## Alternatives considered

- **`fixedId(inner, id)` free-function wrapper that self-overrides** (the
  downstream adapter, blessed). Rejected as the primary mechanism: it works by
  _discarding_ the id `compose()` passes (`_id => inner.build(s, id, …)`), an
  inversion of the `Lifecycle` contract. `at()` reaches the same outcome while
  the framework passes the intended id, so the `id` argument is never thrown
  away. The two differ only in honesty and in the collision guard, for the same
  call-site cost.
- **`withIds({ key: id })` — a parent-side map companion to `withStacks`.**
  Workable and per-component, but it places id control in a separate chained
  method parallel to stack routing, away from where the component is declared,
  and threads extra state through `#buildWith` plus the
  `ComposedSystem`/`ConfiguredSystem` interface split. `at()` is co-located with
  the component and adds no interface surface.
- **`withIdStrategy((parentId, key) => id)` — a pluggable hook analogous to
  `StackStrategy`.** The most general option and the most surface, for a need
  that is almost always "pin this one system." A function hook also has no
  guardrails against colliding or invalid ids. Consistent with the project's
  preference for targeted mechanisms over configurable derivation
  ([ADR-0011](0011-cross-component-relationship-guards.md) alternatives), it was
  rejected as speculative; it can supersede this ADR later if id derivation ever
  needs to be pluggable across many call sites.
- **Flatten instead of nest — spread the sub-system's components as siblings so
  no extra key segment is ever created.** This makes the id problem _disappear_
  rather than solving it, and arguably models the delegation use case more
  directly (both zones become first-class `ref` targets). It was not adopted as
  the answer to #245 because it requires authoring sub-systems as exportable
  `{ components, dependencies, stacks }` fragments rather than sealed
  `ComposedSystem`s — a larger, more opinionated change to how systems are
  composed. It remains the better choice when the caller controls sub-system
  authorship; `at()` is the answer when a sub-system must stay a sealed
  `ComposedSystem` (third-party, or to keep the nested-unit encapsulation).
