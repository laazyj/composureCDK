import type { InterfaceVpcEndpointProps } from "aws-cdk-lib/aws-ec2";

/**
 * Defaults applied to every interface endpoint built with
 * {@link createInterfaceEndpointBuilder} / {@link createInterfaceEndpointsBuilder}.
 *
 * DRAFT (#194): only the load-bearing defaults are present — the full
 * Well-Architected JSDoc citations land with the non-draft PR.
 */
export const INTERFACE_ENDPOINT_DEFAULTS: Partial<InterfaceVpcEndpointProps> = {
  /**
   * Private DNS lets `<service>.<region>.amazonaws.com` resolve to the
   * endpoint ENIs, which is what makes SSM-without-NAT work. Off by default
   * in raw CDK for custom services; on here because every AWS-service use
   * case wants it.
   */
  privateDnsEnabled: true,

  /**
   * The builder owns the endpoint's security group (so it can be exposed on
   * the result and `ref`-ed by peers), and defaults it closed. Ingress is
   * opened explicitly via `.allowDefaultPortFrom(peer)`, matching the
   * least-privilege posture of `SECURITY_GROUP_DEFAULTS`.
   */
  open: false,
};
