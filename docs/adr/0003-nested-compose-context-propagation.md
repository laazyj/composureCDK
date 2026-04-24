# ADR 0003: Nested `compose()` — propagate parent context into inner components

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

`ComposedSystem` returned from `compose()` is itself a `Lifecycle`, so the docs
advertise that "composition is recursive — systems can be nested without
special handling." In practice that was only half true. Issue
[#51](https://github.com/laazyj/composureCDK/issues/51) reported that `ref()`
calls inside a nested `compose()` could not resolve against outer siblings, so
the natural "compose subsystems, then compose the subsystems" pattern broke
the moment any wiring crossed a subsystem boundary.

Root cause (pre-change `packages/core/src/compose.ts`):

```ts
build(scope, id) {                 // <- ignored Lifecycle's context arg
  return this.#buildWith(scope, id).results;
}

#buildWith(scope, id, stacks?) {
  for (const key of alg.topsort(this.#graph)) {
    const deps = (this.#dependencies[key] ?? []);
    const context = Object.fromEntries(
      deps.map((dep) => [dep, results[dep]])     // <- inner-only context
    );
    results[key] = this.#components[key].build(..., context);
  }
}
```

`Lifecycle.build(scope, id, context?)` passes a context to every component,
but `ComposedLifecycle.build` dropped that argument — so when a parent
compose built the nested system with `{ dns: {...} }` as context, nothing
downstream ever saw it. `ConfiguredLifecycle.build` (the result of
`.withStacks()` / `.afterBuild()`) had the same defect.

The customer hit this while modelling DNS and Site as two subsystems
wired together. The workaround was to flatten everything into one
top-level `compose()` with per-component `withStacks` routing — which works
but loses the encapsulation benefit of nesting.

## Decision

**Propagate parent context into every inner component's context during
`#buildWith`, with inner dependency values shadowing on key collision.**

Both `ComposedLifecycle.build` and `ConfiguredLifecycle.build` now honour the
`Lifecycle.build(scope, id, context?)` contract, accept the parent context,
and thread it through to each component:

```ts
const innerContext = Object.fromEntries(deps.map((dep) => [dep, results[dep]]));
const context = { ...parentContext, ...innerContext };
```

After the change, the developer pattern is:

```ts
const dns = compose({ zone, records }, { zone: [], records: ["zone"] });
const site = compose({ cert, bucket, cdn }, { cert: [], bucket: [], cdn: ["cert", "bucket"] });

const app = compose(
  { dns, site },
  { dns: [], site: ["dns"] }, // outer edge orders dns before site
);
```

Inside `site`'s components, `ref<DnsResult>("dns").get("zone")` resolves —
`dns` is present in the parent context that now flows into each inner
component. Chained `.get()` and `.map()` already work against whatever
context the ref receives, so no changes are needed in `ref.ts`.

### Why this over the alternatives

**Option considered: explicit `imports` API.** `compose(components, deps, { imports: [...] })`
would let us type-check cross-boundary wiring statically. Rejected because
it doubles the compose API surface and is redundant — the outer
`dependencies` map already expresses "site needs dns," and refs already
capture "which key to read." An `imports` option would restate the same
relationship at the inner boundary. Revisit only if a concrete type-safety
gap emerges.

**Option considered: document the limitation and keep isolation.** Rejected
because the customer case shows the natural pattern is nested composition.
Forcing flattening is a real ergonomics tax, and the docs already promise
recursive composition — the code should match.

## Consequences

- A nested `ComposedSystem` is no longer isolated from its parent. Inner
  refs to an outer sibling key now resolve instead of throwing. The
  existing nested-compose test (a nested system with no cross-boundary
  refs) still passes unchanged.
- Cross-boundary refs are not expressed in the inner dependency graph.
  The outer topsort orders things correctly (because the outer
  `dependencies` map encodes "site needs dns"), but an inner ref to an
  outer key is resolved at runtime against the received context, not
  validated against the inner graph. This matches how refs already
  behave — a missing key throws the same "cannot be resolved" error.
- Key collision (inner dep and outer sibling both named `x`): inner
  shadows. This is the intuitive rule and matches lexical scoping; a
  future change could add a warning if collisions become a confusion
  source in practice.
- `.withStacks()` / `.withStackStrategy()` / `.afterBuild()` continue to
  work both at the outermost level and on nested systems. The
  `ConfiguredLifecycle.build` signature and its internal `buildFn` type
  pick up an optional `parentContext` parameter.
- Flat-compose + `withStacks` remains a perfectly valid style. The
  customer's existing code is not affected. Nesting is now a choice, not
  a trap.
- A lint rule (`composurecdk/lifecycle-build-context-required` in
  `eslint.config.mjs`) flags any `Lifecycle`-implementing class whose
  `build` method omits the `context` parameter while the class body uses
  `Resolvable<…>`. Such a builder accepts refs at configuration time but
  has no way to resolve them at build time — the rule catches the
  mismatch at lint time rather than as a runtime "cannot be resolved"
  throw. Optionality of `context` is preserved for leaf builders that
  don't use refs.
