import type { ConstraintNamespace } from "@composurecdk/cloudformation";
import { validateAlarmName } from "./alarm-name.js";

export type { AlarmConfig, AlarmConfigDefaults } from "./alarm-config.js";
export type { AlarmDefinition, AlarmMetric } from "./alarm-definition.js";
export { AlarmDefinitionBuilder } from "./alarm-definition-builder.js";
export { type AlarmName, alarmName } from "./alarm-name.js";
export { defaultAlarmName } from "./default-alarm-name.js";
export { createAlarms } from "./create-alarms.js";
export { resolveAlarmConfig, type ResolvedAlarmConfig } from "./resolve-alarm-config.js";
export { alarmActionsPolicy } from "./policies/alarm-actions-policy.js";
export type {
  AlarmActionsPolicyConfig,
  AlarmMatchContext,
  AlarmMatcher,
} from "./policies/alarm-actions-policy.js";
export {
  alarmNamePolicy,
  type AlarmNamePolicyConfig,
  type AlarmNameRule,
  type AlarmNameTransformContext,
} from "./policies/alarm-name-policy.js";

/**
 * This package's AWS-property constraints, grouped by application strategy.
 * The `constraints.validate.*` / `constraints.sanitize.*` shape is identical in
 * every builder package; the underlying constraint definition stays
 * module-private. The branded {@link alarmName} constructor layers on top of the
 * same validation. See ADR-0010.
 */
export const constraints = {
  validate: { alarmName: validateAlarmName },
  sanitize: {},
} satisfies ConstraintNamespace;
