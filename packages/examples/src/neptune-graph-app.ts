import { App, Stack } from "aws-cdk-lib";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  InterfaceVpcEndpointAwsService,
  MachineImage,
  type ISecurityGroup,
  type IVpc,
  SubnetType,
  type Instance,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import {
  createInstanceBuilder,
  createSecurityGroupBuilder,
  createVpcBuilder,
  type InstanceBuilderResult,
  type SecurityGroupBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { createClusterBuilder } from "@composurecdk/neptune";
import { InstanceType as NeptuneInstanceType } from "@aws-cdk/aws-neptune-alpha";

/**
 * A VPC + a serverless Amazon Neptune cluster + an SSM-managed bastion that
 * can actually reach and query the graph, composed into a single stack.
 *
 * Demonstrates:
 * - {@link createClusterBuilder} with well-architected defaults (encryption
 *   at rest, IAM authentication, audit-log export with an auto-created
 *   audit-log-enabled cluster parameter group, 7-day backups, RETAIN) and
 *   the serverless capacity recommended alarm.
 * - The declarative `allowAccessFrom(ref(...))` grant: the cluster opens its
 *   port to the bastion's security group **and** grants the bastion IAM
 *   `connect` in a single call wired inside `compose()` — the access
 *   relationship is data in the dependency graph, not `afterBuild` glue.
 * - {@link createSecurityGroupBuilder} for the bastion's closed-egress SG.
 *   The only egress rules are the ones the cross-component wiring adds:
 *   `:8182` to Neptune (via `allowAccessFrom`) and `:443` to the SSM
 *   interface endpoints — least privilege, made visible.
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

  const result = compose(
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
        ),

      graph: createClusterBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
        .instanceType(NeptuneInstanceType.SERVERLESS)
        .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 2.5 })
        .allowAccessFrom(
          ref<InstanceBuilderResult>("bastion").map(
            (r: InstanceBuilderResult): Instance => r.instance,
          ),
        ),
    },
    {
      network: [],
      bastionSg: ["network"],
      bastion: ["network", "bastionSg"],
      graph: ["network", "bastion"],
    },
  ).build(stack, "NeptuneGraphApp");

  // SSM Session Manager reachability without a NAT gateway: interface
  // endpoints for the three services the agent needs. Each opens :443 to the
  // bastion only, which also adds the matching egress rule on the bastion's
  // closed-egress SG.
  addSsmEndpoints(result.network.vpc, result.bastion.instance);

  return { stack };
}

function addSsmEndpoints(vpc: IVpc, bastion: Instance): void {
  const services = {
    Ssm: InterfaceVpcEndpointAwsService.SSM,
    SsmMessages: InterfaceVpcEndpointAwsService.SSM_MESSAGES,
    Ec2Messages: InterfaceVpcEndpointAwsService.EC2_MESSAGES,
  };
  for (const [id, service] of Object.entries(services)) {
    const endpoint = vpc.addInterfaceEndpoint(`${id}Endpoint`, {
      service,
      subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      open: false,
    });
    endpoint.connections.allowDefaultPortFrom(bastion, `${id} from Neptune bastion`);
  }
}
