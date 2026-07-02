# ADR 0013: Role-parameterized queue builder with per-role typed surfaces

- **Status:** Proposed
- **Date:** 2026-07-02

## Context

Standard, FIFO, and dead-letter SQS queues have partly mutually exclusive
configuration and inverted alarm recommendations (#34, #117):

- FIFO-only props (`fifo`, `contentBasedDeduplication`, `deduplicationScope`,
  `fifoThroughputLimit`) are rejected by AWS on standard queues, and FIFO adds
  coupled invariants — the `.fifo` name suffix, the high-throughput
  `fifoThroughputLimit`/`deduplicationScope` pairing.
- A dead-letter queue must not carry its own `deadLetterQueue` redrive policy,
  wants the maximum 14-day retention, and inverts the recommended-alarm set:
  any visible message is itself the alert, while the primary-queue "consumer
  falling behind" and "in-flight quota" signals don't apply.
- The two axes combine: AWS requires a FIFO source's DLQ to itself be FIFO,
  so "FIFO dead-letter queue" is a real configuration, not an edge case.

PR #253 prototyped a role switch as a fluent method (`.asDeadLetterQueue()`)
on `createQueueBuilder()`. The behaviour was right, but the prop surface
wasn't: every prop stayed reachable in every role — `deadLetterQueue` on a
DLQ, `fifo` with primary-only alarm defaults — so invalid configurations
were representable and only caught (if at all) at build time. The root cause
is structural: `IBuilder<Props, T>` regenerates the full prop surface from
`Props` after every setter, so a _mid-chain_ method can never narrow the
type of what follows it.

## Decision

**Keep one entry point, but move role selection to the factory argument:
`createQueueBuilder(role?)` with
`QueueRole = "standard" | "fifo" | "dlq" | "fifo-dlq"`. Overloads bind each
role to its own `Props` surface, so every role gets an exact fluent API from
the same single builder implementation.**

1. **The factory argument is the type boundary a fluent method can't be.**
   `createQueueBuilder<R extends QueueRole>(role: R): IQueueBuilder<R>` with
   `IQueueBuilder<R> = ITaggedBuilder<QueueBuilderPropsByRole[R], QueueBuilder>`.
   The per-role surfaces live in `queue-props.ts`: the standard surface omits
   the FIFO-only props, the FIFO surfaces omit `fifo` (always `true`) and
   retype `queueName` as `` `${string}.fifo` ``, and the dead-letter surfaces
   omit `deadLetterQueue`. Untyped callers hit equivalent build-time guards
   whose messages name the role to use instead.

2. **The role is data, not class identity.** It is stored as an internal prop
   (`queueRole`), set once by the factory and invisible on the public
   surfaces. Because it rides in `props`, `.copy()` preserves it for free
   (no `[COPY_STATE]` special case — the gap PR #253 had to patch), and it
   is inspectable. One flat `QueueBuilder` class backs every role; `build()`
   derives two booleans (`isFifoRole`, `isDlqRole`) and layers defaults
   accordingly: `QUEUE_DEFAULTS` → `DLQ_QUEUE_DEFAULTS` (dlq roles) → user
   props → `fifo: true` (fifo roles, after user props so it cannot be
   unset).

3. **Roles compose where factories multiply.** `"fifo-dlq"` demonstrates the
   scaling argument: the types × roles product is four combinations today,
   and each is one union member plus one row in the props map — not a new
   entry point. The alternative (sibling factories, explored in a parallel
   PR) needs either a factory per combination or a compromise where FIFO
   props leak back onto the DLQ builder as passthrough.

4. **Alarm behaviour is a data profile, not builder branching.** A
   `QueueAlarmProfile` couples per-alarm enablement, merge defaults, and
   descriptions; `resolveQueueAlarmDefinitions` is a single loop over the
   alarm keys. Primary roles use `PRIMARY_ALARM_PROFILE`; dead-letter roles
   use `dlqAlarmProfile(scope, retentionPeriod)`, whose age-alarm default
   scales to 75% of the queue's resolved retention — so the "about to age
   out" signal stays meaningful when retention is tuned, avoiding the
   threshold-can-never-fire class of bug that #117 flagged. A token-valued
   retention has no derivable basis, so the age alarm is skipped with the
   standardized acknowledgeable warning (`resolveAlarmThresholdBasis` from
   `@composurecdk/cloudwatch`, per #196). Profile defaults are partial: an
   alarm with no generic baseline (`approximateNumberOfMessagesVisible` on a
   primary queue) throws when enabled without an explicit threshold, rather
   than inheriting a placeholder value that alarms on noise.

5. **Discovery is carried by the single entry point.** Autocomplete on the
   factory argument enumerates every role; there is no sibling factory to
   fail to find. The validation guards, `QueueRole` JSDoc, and the "Queue
   roles" table atop the package README carry the rest.

## Consequences

- Invalid queue configurations become unrepresentable in typed code:
  `deadLetterQueue` on a dead-letter role and `fifo` on a standard queue are
  compile errors, not runtime surprises — while the package keeps exactly
  one entry point.
- A future role (one more union member + props-map row + defaults layer +
  alarm profile) requires no new factory and no new builder class. A role
  whose _behaviour_ diverges beyond defaults/alarms/validation would strain
  the single `build()` and should prompt revisiting the sibling-factory
  split.
- `QueueBuilderProps` no longer includes the FIFO props — a breaking change
  for callers who used the passthrough from #115; they move to
  `createQueueBuilder("fifo")` unchanged otherwise. `IQueueBuilder` gains a
  defaulted type parameter (`IQueueBuilder<R = "standard">`), which is
  non-breaking for existing annotations.
- Passing a role as a _variable_ of type `QueueRole` (rather than a literal)
  degrades the builder type to the intersection of the role surfaces; role
  choice is expected to be static at authoring time.
- The rejected alternatives: a mid-chain role method (cannot narrow types —
  see Context); one factory per queue type (explored in a parallel PR — the
  same behaviour with N entry points and a factory-vs-prop compromise for
  combinations).
