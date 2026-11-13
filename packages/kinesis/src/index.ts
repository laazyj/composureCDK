import type { ConstraintNamespace } from "@composurecdk/cloudformation";
import { validateStreamConsumerName, validateStreamName } from "./stream-name.js";

export {
  createStreamBuilder,
  type StreamBuilderProps,
  type StreamBuilderResult,
  type StreamPolicyStatement,
  type IStreamBuilder,
} from "./stream-builder.js";
export { streamGrants } from "./grants.js";
export { STREAM_DEFAULTS } from "./defaults.js";
export { type StreamAlarmConfig } from "./stream-alarm-config.js";
export { STREAM_ALARM_DEFAULTS } from "./stream-alarm-defaults.js";

// Enhanced fan-out consumers.
export {
  createStreamConsumerBuilder,
  type StreamConsumerBuilderProps,
  type StreamConsumerBuilderResult,
  type IStreamConsumerBuilder,
} from "./stream-consumer-builder.js";
export { streamConsumerGrants } from "./grants.js";
export { type StreamConsumerAlarmConfig } from "./stream-consumer-alarm-config.js";
export { STREAM_CONSUMER_ALARM_DEFAULTS } from "./stream-consumer-alarm-defaults.js";

/**
 * This package's AWS-property constraints, grouped by application strategy.
 * The `constraints.validate.*` / `constraints.sanitize.*` shape is identical
 * in every builder package, so it is discoverable without importing anything
 * beyond the package you already use. The underlying constraint definitions and
 * `validate*` functions stay module-private — this namespace is the only public
 * surface for them. See ADR-0010.
 */
export const constraints = {
  validate: {
    streamName: validateStreamName,
    streamConsumerName: validateStreamConsumerName,
  },
  sanitize: {},
} satisfies ConstraintNamespace;
