/**
 * The role a queue plays in its system, chosen at the factory:
 * `createQueueBuilder(role)`. The role selects the builder's prop
 * surface (each role exposes only the props that apply to it), its
 * defaults, its recommended-alarm profile, and its validation:
 *
 * - `"standard"` — a primary, consumer-fed standard queue (the
 *   default). FIFO-only props are excluded.
 * - `"fifo"` — a primary FIFO queue: `fifo: true` always, `queueName`
 *   typed to require the `.fifo` suffix, high-throughput coherence
 *   validated.
 * - `"dlq"` — a standard dead-letter queue: 14-day retention, inverted
 *   alarm set (any visible message alerts), no `deadLetterQueue` — a
 *   DLQ is a terminal destination.
 * - `"fifo-dlq"` — a FIFO dead-letter queue for a FIFO source (AWS
 *   requires the DLQ of a FIFO queue to be FIFO): combines the FIFO
 *   surface with the DLQ defaults and alarms.
 *
 * Modeled as data rather than separate factories so that roles compose
 * (`"fifo-dlq"` is a role, not a fourth entry point) and the choice is
 * copy-safe, inspectable state on the builder.
 */
export type QueueRole = "standard" | "fifo" | "dlq" | "fifo-dlq";

/** Whether the role builds a FIFO queue. */
export function isFifoRole(role: QueueRole): boolean {
  return role === "fifo" || role === "fifo-dlq";
}

/** Whether the role builds a dead-letter queue. */
export function isDlqRole(role: QueueRole): boolean {
  return role === "dlq" || role === "fifo-dlq";
}
