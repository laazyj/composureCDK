export {
  createQueueBuilder,
  type IQueueBuilder,
  type QueueBuilderResult,
} from "./queue-builder.js";
export { queueGrants } from "./grants.js";
export { type QueueRole } from "./queue-role.js";
// The per-role *BuilderProps types (and the role→props map inside
// IQueueBuilder) must be barrel-exported per ADR-0001: a consumer's
// inferred type expands to `ITaggedBuilder<FifoQueueBuilderProps, …>`
// after any setter call, so declaration emission has to be able to
// name them (TS2883 otherwise).
export {
  type FifoQueueName,
  type QueueBuilderProps,
  type FifoQueueBuilderProps,
  type DlqQueueBuilderProps,
  type FifoDlqQueueBuilderProps,
  type QueueBuilderPropsByRole,
} from "./queue-props.js";
export { QUEUE_DEFAULTS } from "./defaults.js";
export { DLQ_QUEUE_DEFAULTS } from "./dlq-defaults.js";
export { type QueueAlarmConfig } from "./queue-alarm-config.js";
export { QUEUE_ALARM_DEFAULTS } from "./queue-alarm-defaults.js";
export { DLQ_ALARM_DEFAULTS } from "./dlq-alarm-defaults.js";
