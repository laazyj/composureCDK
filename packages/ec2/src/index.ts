import type { ConstraintNamespace } from "@composurecdk/cloudformation";
import {
  validateSecurityGroupDescription,
  validateSecurityGroupName,
} from "./security-group-constraints.js";

export {
  createInstanceBuilder,
  type IInstanceBuilder,
  type InstanceBuilderProps,
  type InstanceBuilderResult,
} from "./instance-builder.js";
export { INSTANCE_DEFAULTS } from "./instance-defaults.js";
export { type InstanceAlarmConfig } from "./instance-alarm-config.js";
export { INSTANCE_ALARM_DEFAULTS } from "./instance-alarm-defaults.js";
export { type AttachVolumeOptions } from "./instance-volume-attachments.js";
export { type VolumeAttachmentAlarmConfig } from "./instance-volume-attachment-config.js";
export { VOLUME_ATTACHMENT_ALARM_DEFAULTS } from "./instance-volume-attachment-defaults.js";

export {
  createVolumeBuilder,
  type IVolumeBuilder,
  type VolumeBuilderProps,
  type VolumeBuilderResult,
} from "./volume-builder.js";
export { VOLUME_DEFAULTS } from "./volume-defaults.js";
export { type VolumeAlarmConfig } from "./volume-alarm-config.js";
export { VOLUME_ALARM_DEFAULTS } from "./volume-alarm-defaults.js";

export {
  createVpcBuilder,
  type FlowLogsConfig,
  type IVpcBuilder,
  type VpcBuilderProps,
  type VpcBuilderResult,
} from "./vpc-builder.js";
export { VPC_DEFAULTS } from "./vpc-defaults.js";

export {
  createSecurityGroupBuilder,
  type ISecurityGroupBuilder,
  type SecurityGroupBuilderProps,
  type SecurityGroupBuilderResult,
} from "./security-group-builder.js";
export { SECURITY_GROUP_DEFAULTS } from "./security-group-defaults.js";
export {
  SECURITY_GROUP_DESCRIPTION,
  SECURITY_GROUP_NAME,
  validateSecurityGroupDescription,
  validateSecurityGroupName,
} from "./security-group-constraints.js";

/**
 * This package's AWS-property constraints, grouped by application strategy.
 * The `constraints.validate.*` / `constraints.sanitize.*` shape is identical
 * in every builder package, so it is discoverable without importing anything
 * beyond the package you already use. See ADR-0010.
 */
export const constraints = {
  validate: {
    securityGroupDescription: validateSecurityGroupDescription,
    securityGroupName: validateSecurityGroupName,
  },
  sanitize: {},
} satisfies ConstraintNamespace;
