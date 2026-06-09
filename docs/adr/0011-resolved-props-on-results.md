# ADR 0011: Expose a builder's resolved configuration on its result

- **Status:** Accepted
- **Date:** 2026-06-09

## Context

Builders frequently need to inspect a property that configured a _sibling_
component, but the CDK L2 construct does not expose it as a public readonly
member. The value lives only on the `*Props` interface, which CDK treats as a
write-only struct ([CDK design guidelines][cdk-guidelines]) — once the
construct is built, the value is unrecoverable from the construct alone.

The case that surfaced this (laazyj/composureCDK#122, blocking #118): the
SQS↔Lambda visibility-timeout invariant — a source queue's `visibilityTimeout`
should be ≥ 6× the consumer function's `timeout`. The `Queue` construct does
not expose `visibilityTimeout`; only `QueueProps` carries it. A consumer that
receives the queue via `ref()` therefore cannot perform a real comparison — it
can only emit a contextual reminder (see the "not enforced" note on
`sqsEventSource`). This is a general gap: _any_ cross-component invariant that
depends on a write-only prop of a dependency is un-checkable today.

Three facts about the codebase frame the decision:

1. **The merged configuration already exists.** Every builder's `build()`
   computes `mergedProps = { ...DEFAULTS, ...userProps }` (with any
   `Resolvable` resolved against `context`) and hands it to the construct. It
   is then discarded.
2. **Results already carry more than the primary construct** — `FunctionBuilderResult.eventSources`,
   `RuleBuilderResult.targets`, `RoleBuilderResult.inlinePolicies`,
   `TopicBuilderResult.subscriptions`. But every "extra" today is a construct
   or a resolved CDK object; **no result exposes the merged scalar config**
   (a `Duration`, a number, an enum) that the construct withholds.
3. **The builder getter is not a substitute.** `queue.visibilityTimeout()`
   reads `props` _before_ defaults are merged and lives on the builder, which
   a sibling never receives — siblings receive the result via `context`.

[architecture.md](../architecture.md) already states the tenet "**if a builder
creates it, the result should expose it**." Resolved configuration is part of
that completeness, not just constructs.

## Decision

**A builder result exposes the resolved configuration it handed to its CDK
construct under a uniform `resolvedProps` field.**

1. **Field name and shape.** Every `*BuilderResult` that wraps a CDK construct
   gains `resolvedProps: ResolvedProps<TConstructProps>`. `ResolvedProps<P>`
   (new, in `@composurecdk/core`) is `Readonly<{ [K in keyof P]?: Resolved<P[K]> }>`:
   every key optional (a prop may be unset, and not every prop has a default),
   read-only (a record of what was built, not a mutable handle), and any
   `Resolvable<T>` collapsed to its resolved `T`.

2. **Semantics: post-default, post-resolve, pre-token-resolution.** The value
   is exactly the object passed to the construct — defaults applied,
   `ref()`s resolved against `context`. It is _not_ deep-resolved: a value may
   still be an unresolved CDK `Token` (e.g. threaded from a `CfnParameter`).
   Consumers comparing values must guard with `Token.isUnresolved`, exactly as
   `QueueBuilder`'s in-builder `warnIfLowMaxReceiveCount` already does.

3. **Typed off the CDK props, not the builder props.** The merged object is
   CDK-props-shaped — builder-specific keys (`recommendedAlarms`) are
   destructured out before the merge, and widened keys (`role: Resolvable<IRole>`)
   are collapsed back to the construct's type (`IRole`). So `QueueBuilderResult`
   uses `ResolvedProps<QueueProps>`, not `ResolvedProps<QueueBuilderProps>`.

4. **Scope is the full merged prop set, not a curated subset.** A curated
   subset reintroduces the "which props will a consumer need?" guessing this
   ADR exists to remove, and the full bag is already in hand at zero cost.
   Where a _specific_ value warrants sharper ergonomics or a narrower type, a
   builder may _additionally_ promote it to a named top-level result field —
   `resolvedProps` is the floor, not a ceiling.

5. **Originates in `build()`, returned as a shallow copy.** Each `build()`
   returns `resolvedProps: { ...mergedProps }`. The copy avoids handing out a
   reference to the literal object the construct retains. This is deliberately
   _not_ a decorator (ADR-0006): a decorator can only wrap the returned result,
   and `mergedProps` is internal to `build()` — the value must originate there.
   `ResolvedProps<P>` keeps the _type_ uniform across packages without
   per-builder machinery.

This PR lands the mechanism (`ResolvedProps` in core) plus the contract on the
two motivating builders — `QueueBuilder` (the #118 unblocker) and
`FunctionBuilder` (which exercises the `Resolvable` collapse via its
`role` prop). Rolling the field out to the remaining `*BuilderResult` types is
a mechanical follow-up, mirroring how ADR-0010 landed a central mechanism plus
first adopters.

## Consequences

- **Cross-component invariants become real checks.** A consumer holding a
  `ref()` to a `QueueBuilderResult` reads `result.resolvedProps.visibilityTimeout`
  and compares it (token-guarded) against its own `timeout`. This unblocks
  #118/#123/#124 and any future invariant of the same shape.
- **The result contract widens.** `resolvedProps` exposes the entire prop bag,
  including values with no cross-component use and potentially sensitive ones
  (e.g. a Lambda's `environment`). This is in-process only and never
  serialised, but it is a public contract — adding it is a minor/feature
  change, never a patch.
- **`.copy()` is unaffected.** `resolvedProps` is build-time output, not
  builder state; it does not interact with `props` cloning or `[COPY_STATE]`.
- **Adopting a new builder is one line plus a type.** Return
  `resolvedProps: { ...mergedProps }` and type the field
  `ResolvedProps<TConstructProps>`. A lint rule could later require the field
  on library results; out of scope here.

## Alternatives considered

- **Curated, named result fields per builder** (`QueueBuilderResult.visibilityTimeout`).
  Rejected as the _primary_ mechanism: precise and low-surface, but reactive —
  every new invariant is a result-type edit, and there is no single predictable
  place for a consumer to look, which #122 explicitly asks for. Retained as an
  opt-in refinement _on top of_ `resolvedProps` (decision point 4).
- **A typed capability/provider channel** (Bazel/Gradle-style providers keyed
  by a `Symbol.for(...)` brand). Rejected for now: it decouples consumer needs
  from prop shape and advertises only what is meant to be consumed, but it is
  disproportionate machinery for the single invariant on the table. Revisit if
  a richer producer→consumer contract emerges.
- **A decorator applying `resolvedProps`** (ADR-0006 family). Rejected: a
  decorator cannot see `mergedProps`, which is internal to `build()`; it could
  only re-expose what `build()` already returns. The value must originate in
  `build()` regardless, so a decorator adds the stacking type-cost ADR-0006
  flags for no benefit here.
- **Status quo — contextual reminders only.** Rejected: it leaves the entire
  class of write-only-prop invariants permanently un-checkable, which is the
  case this ADR exists to close.

[cdk-guidelines]: https://github.com/aws/aws-cdk/blob/main/docs/DESIGN_GUIDELINES.md
