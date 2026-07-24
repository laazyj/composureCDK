# ADR 0017: Stream event source failure handling — bisect by default, DLQ by guard

- **Status:** Proposed
- **Date:** 2026-07-24

## Context

`dynamoEventSource()` (and, later, a `kinesisEventSource()`) wraps CDK's
`DynamoEventSource`, whose out-of-the-box failure behaviour is hostile to a
healthy workload:

- `bisectBatchOnError` defaults to `false`, so one poison record fails its whole
  batch on every retry;
- `retryAttempts` and `maxRecordAge` default to **infinite**, so that poison
  record blocks its shard until the stream's 24 h retention window expires — no
  progress, no alarm beyond a climbing `IteratorAge`;
- there is **no `onFailure` destination**, so the only way to stop retrying is to
  bound the retries — which then drops the record silently.

AWS's guidance for stream consumers is explicit: bisect on error, bound the
retries **and** send exhausted records to a dead-letter destination. We already
default `reportBatchItemFailures: true`; the rest was missing. The question is
how much of this to bake into defaults versus leave to the user, given the
project's rule that a default must be safe, individually overridable, and must
not silently change data-durability semantics (docs/architecture.md, "Defaults").

A second constraint: Kinesis stream support is planned. Whatever we add for
DynamoDB should be the same code Kinesis reuses, since both sources share
`StreamEventSourceProps` and the same failure model.

## Decision

**1. Bisect on error is a default; bounded retries/record-age are not.**
`DEFAULT_STREAM_EVENT_SOURCE_PROPS` (a new shared constant spread by every
stream factory) sets `bisectBatchOnError: true` alongside the existing
`startingPosition: LATEST`, `reportBatchItemFailures: true`, and the ESM
`metricsConfig`. Bisect is a pure behavioural safeguard — it isolates a poison
record without changing what happens to good data — so it is safe to default.

We deliberately do **not** default a finite `retryAttempts` or `maxRecordAge`.
Bounding retries without a dead-letter destination converts "stuck" into "records
silently dropped" — a durability change the caller must opt into, not inherit.

**2. A DLQ is wired ergonomically, not auto-created.** The factory widens
`onFailure` to `Resolvable<IQueue | IEventSourceDlq>`: pass a queue (or a `ref()`
to a sibling `createQueueBuilder("dlq")` result) and the factory wraps it in an
`SqsDlq` for you, resolving it alongside the table `ref` via `combine` (ADR-0015).
The factory owns no scope and creates no resources, so it cannot build a DLQ
itself — and it should not: the `sqs` `dlq` role builder already owns queue
creation, 14-day retention, and the depth alarm. Wiring beats duplicating.

**3. The gap between "bounded retries" and "has a DLQ" is closed by a
relationship guard, not a default.** A new synth-time guard
(`STREAM_DLQ_WARNING_ID`) registered in the `dynamodb` slot of
`EVENT_SOURCE_RELATIONSHIP_GUARDS` reads the mapping's L1
`CfnEventSourceMapping` and warns, suppressibly, when `maximumRetryAttempts` or
`maximumRecordAgeInSeconds` is a finite bound but `destinationConfig` is absent —
i.e. exactly the "records will be dropped" configuration. This is the ADR-0011
pattern (builder-registered Aspect, reads a scalar off the L1, warns rather than
throws, silent on unknowable/token values, stable exported ack id).

**4. The shared constant and the guard are source-agnostic.** Both live in the
stream layer, keyed only on facts intrinsic to a stream mapping, so
`kinesisEventSource()` reuses `DEFAULT_STREAM_EVENT_SOURCE_PROPS` verbatim and
adds one row (`kinesis`) to the guard/alarm/id-reader records — no new failure
logic. The guard's second consumer is what will move this ADR from Proposed to
Accepted, per the project convention.

## Consequences

- **Easier:** a default `dynamoEventSource` is poison-pill-resilient out of the
  box, and a durable consumer is one `onFailure: ref("dlq", …)` away, with the
  DLQ's alarms coming for free from the `sqs` builder. The guard turns the
  most common silent-data-loss misconfiguration into a visible, suppressible
  warning.
- **Harder / to note:** `onFailure` is no longer the bare CDK type — it is
  widened (and `startingPosition` is now optional, since the defaults supply it),
  so the factory's props are `DynamoStreamEventSourceProps`, not
  `DynamoEventSourceProps`. Callers who want a bounded-retry consumer without a
  DLQ (accepting the drop) must acknowledge `STREAM_DLQ_WARNING_ID`.
- **Unchanged:** we still create no new alarm constructs here — `IteratorAge`,
  `FailedInvokeEventCount`, and `DroppedEventCount` already cover the consumer,
  and the wired DLQ brings its own depth alarm. The `IteratorAge` default stays
  at 60 s × 3 (quieter than AWS's 30 s starting point) — a deliberate, documented
  tuning, overridable via `recommendedAlarms`.
