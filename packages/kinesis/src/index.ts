import type { ConstraintNamespace } from "@composurecdk/cloudformation";
import { validateStreamName } from "./stream-name.js";

export {
  createStreamBuilder,
  type StreamBuilderProps,
  type StreamBuilderResult,
  type IStreamBuilder,
} from "./stream-builder.js";
export { streamGrants } from "./grants.js";
export { STREAM_DEFAULTS } from "./defaults.js";
export { type StreamAlarmConfig } from "./stream-alarm-config.js";

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
  },
  sanitize: {},
} satisfies ConstraintNamespace;
