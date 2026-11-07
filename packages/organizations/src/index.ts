import type { ConstraintNamespace } from "@composurecdk/cloudformation";
import { validatePolicyDescription, validatePolicyName } from "./policy-constraints.js";
import {
  validateAccountId,
  validateOrganizationalUnitId,
  validatePolicyTargetId,
  validateRootId,
} from "./target.js";

export {
  createServiceControlPolicyBuilder,
  type IServiceControlPolicyBuilder,
  type ServiceControlPolicyBuilderProps,
  type ServiceControlPolicyBuilderResult,
} from "./service-control-policy-builder.js";
export {
  SERVICE_CONTROL_POLICY_QUOTAS,
  type ServiceControlPolicyContent,
  type ServiceControlPolicyStatement,
} from "./policy-content.js";
export { target, type PolicyTarget } from "./target.js";

/**
 * This package's AWS-property constraints, grouped by application strategy.
 * The `constraints.validate.*` / `constraints.sanitize.*` shape is identical in
 * every builder package; the underlying constraint definitions stay
 * module-private — this namespace is their only public surface. See ADR-0010.
 */
export const constraints = {
  validate: {
    policyName: validatePolicyName,
    policyDescription: validatePolicyDescription,
    rootId: validateRootId,
    organizationalUnitId: validateOrganizationalUnitId,
    accountId: validateAccountId,
    policyTargetId: validatePolicyTargetId,
  },
  sanitize: {},
} satisfies ConstraintNamespace;
