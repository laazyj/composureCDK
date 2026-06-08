import { App, Stack } from "aws-cdk-lib";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  SubnetType,
  type Instance,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import {
  createInstanceBuilder,
  createVpcBuilder,
  type InstanceBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { createClusterBuilder } from "@composurecdk/neptune";
import { InstanceType as NeptuneInstanceType } from "@aws-cdk/aws-neptune-alpha";

/**
 * A VPC + a serverless Amazon Neptune cluster + a bastion host, composed
 * into a single stack.
 *
 * Demonstrates:
 * - {@link createClusterBuilder} with well-architected defaults (encryption
 *   at rest, IAM authentication, audit-log export with an auto-created
 *   audit-log-enabled cluster parameter group, 7-day backups, RETAIN) and
 *   the serverless capacity recommended alarm.
 * - The declarative `allowAccessFrom(ref(...))` grant: the cluster opens its
 *   port to the bastion's security group **and** grants the bastion IAM
 *   `connect` in a single call wired inside `compose()` — no `afterBuild`
 *   glue, the access relationship is data in the dependency graph.
 *
 * The cluster keeps its stateful `RETAIN` / `deletionProtection` defaults —
 * this is a real-system exemplar. The CI deploy/destroy cycle flips those to
 * allow teardown via `cleanDeskPolicy`, applied at the app level, so the
 * example itself stays production-shaped.
 *
 * The VPC uses cost-free isolated subnets (no NAT gateway): Neptune is
 * VPC-only and needs no internet egress. The bastion therefore has no
 * outbound route either, so SSM Session Manager will not connect as-is — for
 * an interactively reachable jump-box, switch the VPC to NAT/egress subnets
 * (or add interface VPC endpoints for SSM) and place the bastion there. The
 * bastion exists here to demonstrate the access-grant wiring.
 */
export function createNeptuneGraphApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-NeptuneGraphStack");

  compose(
    {
      network: createVpcBuilder()
        .natGateways(0)
        .subnetConfiguration([
          { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        ]),

      bastion: createInstanceBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023()),

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
      bastion: ["network"],
      graph: ["network", "bastion"],
    },
  ).build(stack, "NeptuneGraphApp");

  return { stack };
}
