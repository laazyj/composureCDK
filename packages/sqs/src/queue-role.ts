/**
 * The recommended-defaults role a {@link createQueueBuilder | QueueBuilder}
 * applies. `"primary"` is the default (a consumer-fed queue). `"dlq"`
 * applies dead-letter-queue defaults and inverted alarm semantics via
 * `.asDeadLetterQueue()`.
 *
 * Modeled as a union rather than a boolean so it extends to future roles
 * (e.g. FIFO-tuned defaults) without another builder entry point.
 */
export type QueueRole = "primary" | "dlq";
