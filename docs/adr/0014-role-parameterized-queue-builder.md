# ADR 0014: Role-parameterized builders for mutually-exclusive L2 surfaces

- **Status:** Proposed
- **Date:** 2026-07-02

## Context

Some AWS L2 constructs expose a single flat props type, but the underlying
resource has two or more **roles** — variants that are partly mutually
exclusive in how they are configured. A role-bearing resource typically shows
some combination of:

- **props valid only in some roles** — AWS rejects them elsewhere;
- **defaults that differ or invert between roles** — including recommended
  alarms whose meaning flips;
- **role-local invariants** — a required name suffix, a coupled pair of props
  that must be set together;
- **roles that compose along independent axes** — a resource can sit at the
  intersection of two role dimensions at once.

A single flat builder makes every prop reachable in every role. Invalid
configurations are therefore _representable_ — the type system permits them —
and are caught, if at all, only at build time. The problem is structural, not
cosmetic: `IBuilder<Props, T>` regenerates the full prop surface from `Props`
after every setter, so no _mid-chain_ method can narrow the type of what
follows it. A builder cannot type-gate its own props by anything a caller does
after construction.

SQS is the first resource in the library to hit this squarely (#34, #117).
Standard, FIFO, and dead-letter queues each have a distinct configuration
surface:

- FIFO-only props (`fifo`, `contentBasedDeduplication`, `deduplicationScope`,
  `fifoThroughputLimit`) are rejected by AWS on standard queues, and FIFO adds
  coupled invariants — the `.fifo` name suffix, the high-throughput
  `fifoThroughputLimit`/`deduplicationScope` pairing.
- A dead-letter queue must not carry its own `deadLetterQueue` redrive policy,
  wants the maximum 14-day retention, and **inverts** the recommended-alarm
  set: any visible message is itself the alert, while the primary-queue
  "consumer falling behind" and "in-flight quota" signals do not apply.
- The two axes **combine**: AWS requires a FIFO source's DLQ to itself be
  FIFO, so a "FIFO dead-letter queue" is a real configuration, not an edge
  case — four roles from a 2×2 product.

The behaviour needed here is well understood; the open question is the API
_shape_ that keeps each role's surface honest without multiplying entry
points.

## Decision

**When an L2 resource has mutually-exclusive roles, enumerate the roles as a
union and select the role through the _factory argument_, binding each role to
its own typed prop surface over a single builder implementation. Encode
per-role behaviour as data keyed by role, not as branching inside the
builder.**

The pattern has four moving parts. QueueBuilder
([`packages/sqs/src/queue-builder.ts`](../../packages/sqs/src/queue-builder.ts))
is the reference implementation; the specifics of its prop surfaces, defaults,
and alarm profiles live in that package rather than in this ADR.

1. **Role selection lives on the factory argument — the one type boundary a
   fluent method cannot be.** A factory generic binds a per-role prop surface
   _before_ the chain starts; a mid-chain setter only regenerates the full
   surface (see Context), so it can never narrow what follows. Each role
   therefore gets an exact API — props invalid for the role are absent from its
   type, not merely rejected at runtime — from a single factory. Untyped
   callers reach the same guarantees through build-time validation.

2. **The role is data, not class identity.** It is one internal prop, set by
   the factory and invisible on the public surface. Because it travels in the
   prop store rather than in a private field, variant authoring (`.copy()`) and
   inspection get it for free, and a single builder class backs every role. The
   role only selects which defaults, validation, and alarms apply.

3. **Roles compose as a product where separate entry points would multiply.**
   Independent role axes — here FIFO × dead-letter — combine into one more
   union member rather than a new entry point or a prop leaked across roles.
   This is the pattern's decisive advantage and its clearest applicability
   signal.

4. **Per-role behaviour is data keyed by role, not branching in the builder.**
   Defaults, validation, and recommended-alarm profiles are resolved from the
   role discriminator through one uniform path, so adding a role adds data, not
   conditionals. The queue alarms show how far this reaches — a dead-letter
   role inverts the recommended set and scales its thresholds to the resolved
   retention — but that depth stays a data profile, not builder logic.

Discovery follows from the single entry point: autocomplete on the factory
argument enumerates every role, so there is no sibling factory to fail to find.

### When this pattern applies

- The resource has **two or more mutually-exclusive configuration surfaces** —
  props or defaults that are valid in one role and invalid or inverted in
  another — over what callers still think of as one resource type.
- Especially when those surfaces **compose along independent axes**, so the
  number of valid combinations grows as a product.
- The divergence between roles is confined to **props, defaults, validation,
  and alarm/recommendation data** — things a single `build()` can resolve from
  a role discriminator.

### When it does not

- Roles whose _behaviour_ diverges beyond defaults/validation/data — different
  constructs emitted, materially different `build()` logic — strain the single
  builder and are better served by separate builders.
- Features that are merely optional rather than mutually exclusive belong on
  the flat props surface; a role split there is overhead with no safety gain.
- A resource with a single configuration surface needs none of this.

Per repository convention, this ADR stays **Proposed** until a second resource
adopts the pattern and proves the generalisation. QueueBuilder is the first
example; if a second case fits cleanly the ADR moves to Accepted, and if it
forces changes the pattern is revised here.

## Consequences

- Invalid queue configurations become unrepresentable in typed code:
  `deadLetterQueue` on a dead-letter role and `fifo` on a standard queue are
  compile errors, not runtime surprises — while the package keeps exactly one
  entry point.
- A future role (one more union member + props-map row + defaults layer +
  alarm profile) requires no new factory and no new builder class.
- `QueueBuilderProps` no longer includes the FIFO passthrough props — a
  breaking change for callers who set them on a standard builder; they move to
  `createQueueBuilder("fifo")`, unchanged otherwise. `IQueueBuilder` gains a
  defaulted role type parameter (`IQueueBuilder<R = "standard">`), which is
  non-breaking for existing annotations.
- Passing a role as a _variable_ of type `QueueRole` (rather than a literal)
  degrades the builder type to the intersection of the role surfaces; role
  choice is expected to be static at authoring time.
- Builder authors adopting the pattern take on a discipline: keep role
  divergence in the props/defaults/validation/alarm data, and treat the
  moment a role needs its own `build()` behaviour as the signal to reconsider
  a separate builder.

## Alternatives considered

- **A mid-chain role method** (e.g. `createQueueBuilder().asDeadLetterQueue()`).
  Rejected: it gets the _behaviour_ right but not the _type_. Because
  `IBuilder<Props, T>` regenerates the full prop surface from `Props` after
  every setter, a method partway through the chain can never narrow the type of
  what follows — `deadLetterQueue` stays callable on a DLQ, `fifo` stays
  callable on a standard queue. Invalid configurations remain representable,
  and the role, held outside `props`, needs a bespoke state hand-off to survive
  `.copy()`. This is what motivated moving role selection onto the factory
  argument, the one place a generic can bind a surface before the chain begins.

- **A sibling factory per role** (e.g. `createQueueBuilder`,
  `createFifoQueueBuilder`, `createDeadLetterQueueBuilder`, …). Rejected: it
  gives each role a clean surface but multiplies entry points, and the
  composing axes make that multiplication a product — a FIFO dead-letter queue
  needs either a fourth factory or a compromise where FIFO props leak back onto
  the DLQ builder as passthrough. It also splits discovery across several
  names. The role-parameterized factory collapses the product to a single
  argument while preserving per-role surfaces; a role split into separate
  builders remains the right answer only if a role's _behaviour_ (not just its
  configuration) diverges.
