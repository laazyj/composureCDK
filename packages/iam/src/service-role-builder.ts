import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { createRoleBuilder, type IRoleBuilder } from "./role-builder.js";

/**
 * Creates a pre-configured {@link IRoleBuilder} whose trust policy allows
 * the given AWS service principal to assume the role.
 *
 * Thin sugar over {@link createRoleBuilder} for the most common role shape:
 * a service-assumable role (Lambda, EC2, Budgets, etc.) with no extra
 * trust-policy conditions. Any property set by the caller afterwards
 * (including `assumedBy`) still wins, because the underlying builder
 * simply records the last value written.
 *
 * @param servicePrincipal - The service identifier, e.g.
 *   `"lambda.amazonaws.com"` or `"budgets.amazonaws.com"`.
 * @returns A role builder with `assumedBy` preset to the given service.
 *
 * @example
 * ```ts
 * const role = createServiceRoleBuilder("lambda.amazonaws.com")
 *   .description("Execution role for StopEC2 Lambda")
 *   .addInlinePolicyStatements("StopEC2", [ ... ]);
 * ```
 */
export function createServiceRoleBuilder(servicePrincipal: string): IRoleBuilder {
  return createRoleBuilder().assumedBy(new ServicePrincipal(servicePrincipal));
}
