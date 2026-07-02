# ADR 0013: Queue-type sibling builders with exclusive prop surfaces

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

PR #253 prototyped a role switch (`.asDeadLetterQueue()`) on the single
`createQueueBuilder()`. The behaviour was right, but the prop surface wasn't:
every prop stayed reachable in every role — `deadLetterQueue` on a DLQ,
`fifo` with primary-only alarm defaults — so invalid configurations were
representable and only caught (if at all) at build time. A fluent method also
cannot change the builder's type mid-chain: `IBuilder<Props, T>` regenerates
the full prop surface from `Props` after every setter, so a role method
cannot narrow what follows it.

## Decision

**One factory per queue type, each binding the shared builder machinery to a
type-specific `Props` surface: `createQueueBuilder()` (standard),
`createFifoQueueBuilder()`, and `createDlqQueueBuilder()`.**

1. **Exclusive prop surfaces.** Because the fluent API is a mapped type over
   `Props`, narrowing `Props` narrows the builder: the standard surface is
   `Omit<QueueProps, FifoOnlyPropKey>`, the FIFO surface omits `fifo` (always
   `true`) and retypes `queueName` as `` `${string}.fifo` `` (a template-literal
   type, so a missing suffix is a compile error), and the DLQ surface omits
   `deadLetterQueue`. Untyped callers hit equivalent build-time guards that
   name the entry point they should be using.

2. **Shared internals, not shared class hierarchies.** The builder classes
   stay flat (the core `Builder` proxy discovers methods on the immediate
   prototype only); duplication is limited to the ~15-line
   props/`addAlarm`/`COPY_STATE` skeleton. Everything substantive is shared
   via modules: `QUEUE_DEFAULTS`, `queue-validation.ts` (FIFO invariants,
   redrive-target type match, `maxReceiveCount` floor), `build-queue.ts`
   (construct + alarms + result), and a profile-driven alarm resolver.

3. **Alarm behaviour is a data profile, not builder branching.** A
   `QueueAlarmProfile` couples per-alarm enablement, merge defaults, and
   descriptions; `resolveQueueAlarmDefinitions` is a single loop over the
   alarm keys. Primary builders pass `PRIMARY_ALARM_PROFILE`; the DLQ builder
   passes `dlqAlarmProfile(scope, retentionPeriod)`, whose age-alarm default
   scales to 75% of the queue's resolved retention — so the "about to age
   out" signal stays meaningful when retention is tuned, avoiding the
   threshold-can-never-fire class of bug that #117 flagged. A token-valued
   retention has no derivable basis, so the age alarm is skipped with the
   standardized acknowledgeable warning (`resolveAlarmThresholdBasis` from
   `@composurecdk/cloudwatch`, per #196). Profile defaults are partial: an
   alarm with no generic baseline (`approximateNumberOfMessagesVisible` on a
   primary queue) throws when enabled without an explicit threshold, rather
   than inheriting a placeholder value that alarms on noise.

4. **FIFO-ness on a DLQ is a prop, not a fourth factory.** AWS requires a
   FIFO source's DLQ to be FIFO, so `createDlqQueueBuilder()` keeps the FIFO
   props (validated identically to the FIFO builder). The alternative — a
   `createFifoDlqQueueBuilder()` — is where the sibling-factory pattern stops
   scaling: types × roles is a product, and factories multiply while a prop
   composes. This is the accepted compromise of Option A; the DLQ surface is
   consequently not fully exclusive (FIFO props appear on it without the
   template-literal name type).

5. **Discovery is carried by types and cross-links.** With three entry
   points, the risk is a user configuring FIFO on the standard builder and
   never finding the sibling. Mitigations: the compile error at the call
   site, the build-time guard message naming the right factory, `@link`
   cross-references in every factory's JSDoc, and a "Choosing a builder"
   table at the top of the package README.

## Consequences

- Invalid queue configurations become unrepresentable in typed code:
  `deadLetterQueue` on a DLQ and `fifo` on a standard queue are compile
  errors, not runtime surprises. Each factory's defaults and alarm profile
  are self-documenting at the call site.
- Three entry points must stay in sync as `QueueProps` evolves; the prop
  taxonomy (`FIFO_ONLY_PROP_KEYS`, `FifoQueueName`) in `queue-props.ts` is
  the single place that carving is defined.
- `QueueBuilderProps` no longer includes the FIFO props — a breaking change
  for callers who used the passthrough from #115; they move to
  `createFifoQueueBuilder()` unchanged otherwise.
- The pattern generalises: a future queue variant with its own defaults and
  alarm semantics adds a factory plus an alarm profile, but a variant that
  _combines_ with existing ones (as FIFO × DLQ does) should be a prop on the
  affected builders, not a factory per combination.
- The rejected alternative — a single role-switched builder with per-role
  narrowed types — requires moving role selection to the factory argument to
  work at the type level; that competing design is explored in a parallel PR
  for comparison.
