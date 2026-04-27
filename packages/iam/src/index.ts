export {
  createRoleBuilder,
  type IRoleBuilder,
  type RoleBuilderProps,
  type RoleBuilderResult,
} from "./role-builder.js";
export { ROLE_DEFAULTS } from "./role-defaults.js";
export {
  createManagedPolicyBuilder,
  type IManagedPolicyBuilder,
  type ManagedPolicyBuilderProps,
  type ManagedPolicyBuilderResult,
} from "./managed-policy-builder.js";
export { createServiceRoleBuilder } from "./service-role-builder.js";
export {
  createStatementBuilder,
  StatementBuilder,
  WildcardResourceError,
} from "./statement-builder.js";
