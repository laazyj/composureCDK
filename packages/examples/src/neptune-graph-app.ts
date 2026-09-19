import { App, Stack } from "aws-cdk-lib";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  InterfaceVpcEndpointAwsService,
  MachineImage,
  type ISecurityGroup,
  SubnetType,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import {
  createInstanceBuilder,
  createInterfaceEndpointBuilder,
  createSecurityGroupBuilder,
  createVpcBuilder,
  type SecurityGroupBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import {
  clusterGrants,
  createClusterBuilder,
  type ClusterBuilderResult,
} from "@composurecdk/neptune";
import {
  type DatabaseCluster,
  InstanceType as NeptuneInstanceType,
} from "@aws-cdk/aws-neptune-alpha";

/**
 * A VPC + a serverless Amazon Neptune cluster + an SSM-managed bastion that
 * can actually reach and query the graph, composed into a single stack.
 *
 * Demonstrates:
 * - {@link createClusterBuilder} with well-architected defaults (encryption
 *   at rest, IAM authentication, audit-log export with an auto-created
 *   audit-log-enabled cluster parameter group, 7-day backups, RETAIN) and
 *   the serverless capacity recommended alarm.
 * - The two halves of reaching an IAM-authenticated cluster, each declared
 *   where it belongs and both wired inside `compose()` rather than in
 *   `afterBuild` glue: the cluster's `allowDefaultPortFrom(bastionSg)` writes
 *   the ingress rule into its own security group, and the bastion carries the
 *   consumer-side `clusterGrants.connect(ref("graph"))` data-plane grant on
 *   its own `.grant()`, which lands on the role it runs as (ADR-0013).
 * - {@link createSecurityGroupBuilder} for the bastion's closed-egress SG.
 *   The only egress rules are the ones the cross-component wiring adds:
 *   `:8182` to Neptune and `:443` to the SSM interface endpoints, both via
 *   `allowDefaultPortFrom` — least privilege, made visible.
 * - Three {@link createInterfaceEndpointBuilder} components (`ssmEndpoint`,
 *   `ssmMessagesEndpoint`, `ec2MessagesEndpoint`) that give the isolated
 *   bastion SSM Session Manager reachability without a NAT gateway. Each
 *   opens ingress `:443` from `bastionSg` and wires the matching egress
 *   back onto `bastionSg` — entirely within `compose()`.
 * - A reachable, queryable Neptune in a cost-free isolated VPC (no NAT):
 *   SSM interface endpoints let Session Manager / `SendCommand` reach the
 *   bastion, and the bastion has a network path to the cluster's port. The
 *   post-deploy smoke test SSMs to the bastion and runs an OpenCypher health
 *   query (SigV4-signed against the IAM-authenticated cluster).
 *
 * The cluster keeps its stateful `RETAIN` / `deletionProtection` defaults —
 * this is a real-system exemplar. The CI deploy/destroy cycle flips those to
 * allow teardown via `cleanDeskPolicy`, applied at the app level.
 */
export function createNeptuneGraphApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-NeptuneGraphStack");

  const ssmEndpointBase = createInterfaceEndpointBuilder()
    .vpc(ref<VpcBuilderResult>("network").get("vpc"))
    .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED });

  const bastionSgRef = ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup");

  compose(
    {
      network: createVpcBuilder()
        .natGateways(0)
        .subnetConfiguration([
          { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        ]),

      bastionSg: createSecurityGroupBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .description("Neptune bastion - SSM-managed, egress only to Neptune and SSM endpoints"),

      bastion: createInstanceBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .securityGroup(
          ref<SecurityGroupBuilderResult>("bastionSg").map(
            (r: SecurityGroupBuilderResult): ISecurityGroup => r.securityGroup,
          ),
        )
        // The consumer side of the cluster grant: the bastion asks for Neptune
        // data-plane access, so the edge runs bastion → graph, matching the
        // dependency that already exists. The grant lands on the role CDK
        // creates for the instance.
        .grant(
          clusterGrants.connect(
            ref<ClusterBuilderResult>("graph").map(
              (r: ClusterBuilderResult): DatabaseCluster => r.cluster,
            ),
          ),
        ),

      ssmEndpoint: ssmEndpointBase
        .copy()
        .service(InterfaceVpcEndpointAwsService.SSM)
        .allowDefaultPortFrom(bastionSgRef, "SSM from Neptune bastion"),

      ssmMessagesEndpoint: ssmEndpointBase
        .copy()
        .service(InterfaceVpcEndpointAwsService.SSM_MESSAGES)
        .allowDefaultPortFrom(bastionSgRef, "SSM Messages from Neptune bastion"),

      ec2MessagesEndpoint: ssmEndpointBase
        .copy()
        .service(InterfaceVpcEndpointAwsService.EC2_MESSAGES)
        .allowDefaultPortFrom(bastionSgRef, "EC2 Messages from Neptune bastion"),

      graph: createClusterBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
        .instanceType(NeptuneInstanceType.SERVERLESS)
        .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 2.5 })
        .allowDefaultPortFrom(bastionSgRef, "Neptune bastion to graph"),
    },
    {
      network: [],
      bastionSg: ["network"],
      bastion: ["network", "bastionSg", "graph"],
      ssmEndpoint: ["network", "bastionSg"],
      ssmMessagesEndpoint: ["network", "bastionSg"],
      ec2MessagesEndpoint: ["network", "bastionSg"],
      graph: ["network", "bastionSg"],
    },
  ).build(stack, "NeptuneGraphApp");

  return { stack };
}
