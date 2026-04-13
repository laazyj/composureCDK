import { Duration } from "aws-cdk-lib";
import type { RoleProps } from "aws-cdk-lib/aws-iam";

/**
 * Secure, AWS-recommended defaults applied to every IAM role built with
 * {@link createRoleBuilder}. Each property can be individually overridden
 * via the builder's fluent API.
 */
export const ROLE_DEFAULTS: Partial<RoleProps> = {
  /**
   * Cap the session duration to one hour by default.
   *
   * Short-lived credentials reduce the blast radius of leaked or misused
   * role sessions. Callers that genuinely need longer sessions (for
   * example, long-running batch jobs that assume the role once) should
   * override via {@link IRoleBuilder.maxSessionDuration}.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_permissions_define_guardrails.html
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html
   */
  maxSessionDuration: Duration.hours(1),
};
