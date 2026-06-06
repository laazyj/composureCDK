import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
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
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import {
  createInstanceBuilder,
  createVpcBuilder,
  type InstanceBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { createTopicBuilder } from "@composurecdk/sns";
import { createClusterBuilder } from "@composurecdk/neptune";
import { InstanceType as NeptuneInstanceType } from "@aws-cdk/aws-neptune-alpha";

/**
 * A VPC + a serverless Amazon Neptune cluster + a bastion host + an SNS
 * alert topic, composed into a single stack.
 *
 * Demonstrates:
 * - {@link createClusterBuilder} with well-architected defaults (encryption
 *   at rest, IAM authentication, audit-log export with an auto-created
 *   audit-log-enabled cluster parameter group, 7-day backups) and the
 *   serverless capacity recommended alarm.
 * - The declarative `allowAccessFrom(ref(...))` grant: the cluster opens its
 *   port to the bastion's security group **and** grants the bastion IAM
 *   `connect` in a single call wired inside `compose()` — no `afterBuild`
 *   glue, the access relationship is data in the dependency graph.
 * - Routing every Neptune alarm to the alert topic via `alarmActionsPolicy`.
 *
 * The VPC uses cost-free isolated subnets (no NAT gateway): Neptune is
 * VPC-only and needs no internet egress. The bastion therefore has no
 * outbound route either, so SSM Session Manager will not connect as-is — for
 * an interactively reachable jump-box, switch the VPC to NAT/egress subnets
 * (or add interface VPC endpoints for SSM) and place the bastion there. The
 * bastion exists here to demonstrate the access-grant wiring, which the
 * post-deploy smoke test verifies on the live security groups.
 *
 * `deletionProtection` and `removalPolicy` are overridden to allow the CI
 * deploy/destroy cycle to tear the cluster down — production stacks keep the
 * `RETAIN` defaults.
 */
export function createNeptuneGraphApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-NeptuneGraphStack");

  const { alerts } = compose(
    {
      alerts: createTopicBuilder().displayName("Neptune Alerts"),

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
        )
        // Ephemeral CI stack: allow teardown. Production keeps the RETAIN defaults.
        .deletionProtection(false)
        .removalPolicy(RemovalPolicy.DESTROY),
    },
    {
      alerts: [],
      network: [],
      bastion: ["network"],
      graph: ["network", "bastion"],
    },
  ).build(stack, "NeptuneGraphApp");

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
