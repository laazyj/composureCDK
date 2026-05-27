import type { SecurityGroupProps } from "aws-cdk-lib/aws-ec2";

/**
 * Secure, AWS-recommended defaults applied to every security group built
 * with {@link createSecurityGroupBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * Two properties intentionally have no default — they are application-
 * specific and must be supplied explicitly:
 *   - `vpc` (via the builder's `.vpc()` method)
 *   - `description` (a short, human-readable summary of the SG's purpose)
 */
export const SECURITY_GROUP_DEFAULTS: Partial<SecurityGroupProps> = {
  /**
   * Closed-by-default egress. CDK's stock default is `true`, which creates
   * an implicit `0.0.0.0/0` outbound rule on every SG — flagged by
   * compliance scanners and incompatible with the project's least-privilege
   * stance. Closing egress forces every outbound flow to be expressed as
   * an explicit `addEgressRule` (or `.allowAllOutbound(true)` to opt back
   * into the CDK default).
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_network_protection_layered.html
   */
  allowAllOutbound: false,
};
