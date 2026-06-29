# ADR 0012: Explicit build id — decouple the construct id from the compose key

- **Status:** Accepted
- **Date:** 2026-06-29

## Context

`compose()` derives each component's construct id from its key, passing
`` `${parentId}/${key}` `` as the `build` id. The key therefore does double
duty: it is both the **wiring name** (used in the dependency map and in
`ref()`/context lookups) and the **construct id segment**. For most systems that
coupling is invisible and convenient.

It becomes destructive the moment an already-deployed system is nested as a
component inside a parent `compose()` (laazyj/composureCDK#245). CDK hashes the
**full construct path string**, so the inserted key segment rotates _every_
logical id in the nested system and CloudFormation replaces every resource. A
zone record built standalone at `jasonduffett.net/records/aExchange` moves to
`jasonduffett.net/jduffett/records/aExchange` once nested under key `jduffett` —
a different hash, a different logical id. No combination of parent id + key
reproduces the original single-segment path.

The motivating case: a live apex site and a brand-new subsite should become two
sub-lifecycles of one `compose()` so a delegation record can `ref()` both zones.
The subsite's ids may change; the apex's must stay byte-for-byte identical or the
refactor replaces a production zone, distribution, bucket and ~20 DNS records.

## Decision

**A component may be tagged with an explicit construct id via `at(id, inner)`.
`compose()` builds a tagged component under that id verbatim instead of deriving
`` `${parentId}/${key}` ``, while the component's wiring key is unaffected.** This
separates the key's two roles — wiring name vs. construct id — so a nested system
can preserve the logical ids it had standalone.

- **The wiring key is untouched.** `at()` changes only the construct id; the
  dependency map, topological sort, and `ref()`/context lookups still key off the
  original key. Only the path segment passed to `build` changes.
- **Collisions are guarded per scope.** A pinned id re-roots into the sibling
  namespace of the scope it builds into, where it can collide with a derived id
  or another pin. `compose()` tracks ids per scope and throws a typed
  `DuplicateConstructIdError` at composition time, instead of letting it surface
  as an opaque CDK duplicate-construct error deeper in synth. The same id in two
  different stacks (via `withStacks`) remains legal.
- **`at` is the only new public surface** — one function, no new interface or
  chained method. (Implementation: the id rides a realm-agnostic `Symbol.for`
  brand that only `compose()` reads, the same cross-realm convention as the `Ref`
  brand — [ADR-0007](0007-dual-esm-cjs-publishing.md); the tagged value still
  structurally satisfies `Lifecycle<T>`, so `BuildResult` inference is unchanged.)

## Consequences

- **Nesting a deployed system no longer rotates its logical ids.**
  `compose({ jduffett: at("jasonduffett.net", apex), clara }, …)` builds apex's
  components at `jasonduffett.net/<key>`, byte-identical to standalone. Resolves
  #245 and unblocks the compose-of-sub-lifecycles refactor.
- **New invariant: the compose key is no longer guaranteed to equal the construct
  id segment.** This is the deliberate decoupling. Readers and tooling that
  assumed `${parentId}/${key}` must consult the _effective_ id.
- **Callers own id uniqueness.** The per-scope guard turns a misuse into an early,
  named error, but does not choose non-colliding ids for the caller.
- `architecture.md`'s nesting section gains a short note, since id preservation
  under nesting is core `compose()` behaviour rather than a niche concern.

## Alternatives considered

- **`withIds({ key: id })` — a parent-side map, a companion to `withStacks`.**
  Per-component and workable, but places id control in a separate chained method
  away from where the component is declared, and threads extra state through the
  system-interface split. `at()` is co-located with the component and adds no
  interface surface.
- **`withIdStrategy((parentId, key) => id)` — a pluggable derivation hook.** The
  most general option and the most surface, for a need that is almost always "pin
  this one system," and with no guardrail against colliding ids. Rejected as
  speculative, consistent with the project's preference for targeted mechanisms
  over configurable derivation ([ADR-0011](0011-cross-component-relationship-guards.md));
  it can supersede this ADR later if id derivation ever needs to be pluggable.
- **Flatten instead of nest — spread the sub-system's components as siblings** so
  no extra key segment is created. This makes the id problem _disappear_ and
  arguably models the delegation case more directly, but requires authoring
  sub-systems as open `{ components, dependencies, stacks }` fragments rather than
  sealed `ComposedSystem`s. It is the better choice when the caller controls
  sub-system authorship; `at()` is the answer when a sub-system must stay a sealed
  unit (third-party, or to keep encapsulation).
- **A self-overriding `fixedId(inner, id)` wrapper that discards the id
  `compose()` passes** (the existing downstream workaround). Reaches the same
  outcome by inverting the `Lifecycle` contract — the component throws away the
  framework-supplied id — and has no collision guard. `at()` keeps the `build` id
  meaningful end to end for the same call-site cost.
