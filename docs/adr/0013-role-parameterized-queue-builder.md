# ADR 0013: Role-parameterized builders for mutually-exclusive L2 surfaces

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

The factory argument is the type boundary a fluent method cannot be: a factory
generic can bind a per-role `Props` surface before the chain starts, where a
mid-chain setter only ever regenerates the full surface. For SQS:

1. **Role selection lives on the factory.**
   `createQueueBuilder<R extends QueueRole>(role?: R)` with
   `QueueRole = "standard" | "fifo" | "dlq" | "fifo-dlq"`. Overloads bind each
   role to its own props surface (in `queue-props.ts`): the standard surface
   omits the FIFO-only props, the FIFO surfaces omit `fifo` (always `true`) and
   retype `queueName` as `` `${string}.fifo` ``, and the dead-letter surfaces
   omit `deadLetterQueue`. The dead-letter surfaces are _derived_ from their
   primary counterparts (`Omit<…, "deadLetterQueue">`) so they cannot drift.
   Untyped callers hit equivalent build-time guards whose messages name the
   role to use instead.

2. **The role is data, not class identity.** It is stored as an internal prop
   (`queueRole`), set once by the factory and invisible on the public
   surfaces. Because it rides in `props`, `.copy()` preserves it for free — no
   special-case state hand-off — and it is inspectable. One flat
   `QueueBuilder` class backs every role; `build()` derives two booleans
   (`isFifoRole`, `isDlqRole`) and layers defaults accordingly:
   `QUEUE_DEFAULTS` → `DLQ_QUEUE_DEFAULTS` (dlq roles) → user props →
   `fifo: true` (fifo roles, after user props so it cannot be unset).

3. **Roles compose where entry points would multiply.** `"fifo-dlq"` is the
   payoff: the role product is four combinations today, and each is one union
   member plus one row in the props map — not a new factory or a leaked prop.
   Composition along independent axes is the strongest signal for this
   pattern, because the alternatives scale multiplicatively (see below).

4. **Per-role behaviour is a data profile, not builder branching.**
   Validation is one `validateQueueProps(scope, id, role, props)` entry point
   where each guard owns its own applicability, so a new role adds no branch to
   the builder. Alarms follow the same shape: a `QueueAlarmProfile` couples
   per-alarm enablement, merge defaults, and descriptions, and
   `resolveQueueAlarmDefinitions` is a single loop over the alarm keys. Primary
   roles use `PRIMARY_ALARM_PROFILE`; dead-letter roles use
   `dlqAlarmProfile(scope, retentionPeriod)`, whose age-alarm default scales to
   75% of the queue's _resolved_ retention — so the "about to age out" signal
   stays meaningful when retention is tuned, avoiding the
   threshold-can-never-fire class of bug. A token-valued retention has no
   derivable basis, so the age alarm is skipped with the standardized
   acknowledgeable warning (`resolveAlarmThresholdBasis` from
   `@composurecdk/cloudwatch`). Profile defaults are partial: an alarm with no
   generic baseline (`approximateNumberOfMessagesVisible` on a primary queue)
   throws when enabled without an explicit threshold, rather than inheriting a
   placeholder value that alarms on noise.

5. **Discovery rides the single entry point.** Autocomplete on the factory
   argument enumerates every role; there is no sibling factory to fail to
   find. The validation guards, `QueueRole` JSDoc, and the "Queue roles" table
   atop the package README carry the rest.

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
