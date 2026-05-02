import type { VpcProps } from "aws-cdk-lib/aws-ec2";

/**
 * Secure, cost-conscious defaults applied to every VPC built with
 * {@link createVpcBuilder}. Each property can be individually overridden
 * via the builder's fluent API.
 *
 * Subnet layout uses CDK defaults (one public + one private-with-egress
 * subnet per AZ) — override `subnetConfiguration` for custom topologies.
 *
 * Flow logs are created separately by the builder (not via this defaults
 * object) so the destination log group can be auto-managed with
 * well-architected retention/removal policies.
 */
export const VPC_DEFAULTS: Partial<VpcProps> = {
  /**
   * Two availability zones strike a balance between high availability
   * and cost. Override to 3+ AZs for production workloads that need
   * stricter HA guarantees.
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html
   */
  maxAzs: 2,

  /**
   * Single NAT gateway is a cost-conscious default. Production HA
   * workloads should override this to match `maxAzs` so a single-AZ
   * NAT failure does not partition private-subnet egress.
   * @see https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
   */
  natGateways: 1,

  /**
   * Required for internal DNS resolution for most AWS managed services
   * (ALB, RDS, VPC endpoints). Default-on in AWS but set explicitly for
   * safety across CDK feature-flag configurations.
   * @see https://docs.aws.amazon.com/vpc/latest/userguide/vpc-dns.html
   */
  enableDnsSupport: true,

  /**
   * Required alongside DNS support for instances to receive public DNS
   * hostnames. Needed for most hostname-based TLS and service discovery
   * scenarios.
   * @see https://docs.aws.amazon.com/vpc/latest/userguide/vpc-dns.html
   */
  enableDnsHostnames: true,

  /**
   * Strip all rules from the default security group. This prevents
   * accidentally using the default SG (which allows all intra-SG
   * traffic and no ingress) and forces explicit SG design — a
   * foundational well-architected security practice.
   *
   * Also enabled by the `@aws-cdk/aws-ec2:restrictDefaultSecurityGroup`
   * feature flag; we set it explicitly so the guarantee holds regardless
   * of CDK context configuration.
   * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html#restrictdefaultsecuritygroup
   */
  restrictDefaultSecurityGroup: true,
};
