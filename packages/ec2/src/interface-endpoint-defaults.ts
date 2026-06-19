import type { InterfaceVpcEndpointProps } from "aws-cdk-lib/aws-ec2";

/**
 * Secure, AWS-recommended defaults applied to every interface endpoint built
 * with {@link createInterfaceEndpointBuilder}. Each property can be
 * individually overridden via the builder's fluent API.
 *
 * Note `open` is intentionally *not* here: the builder always sets it to
 * `false` (see the builder's `build()`). Allowing it through would silently
 * add a VPC-wide rule to the managed security group behind the caller's back;
 * ingress is always explicit — via `.allowDefaultPortFrom()` (managed SG) or
 * the BYO `SecurityGroupBuilder`.
 */
export const INTERFACE_ENDPOINT_DEFAULTS: Partial<InterfaceVpcEndpointProps> = {
  /**
   * Private DNS enables `<service>.<region>.amazonaws.com` to resolve to the
   * endpoint ENIs instead of the public service IP addresses, keeping traffic
   * on the AWS network without requiring application-level changes. Disabled
   * by default in raw CDK; always on here because every AWS-service use case
   * requires it for transparent private access.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_network_protection_private_connectivity.html
   */
  privateDnsEnabled: true,
};
