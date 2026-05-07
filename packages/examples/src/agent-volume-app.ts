import { App, Size, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import {
  createInstanceBuilder,
  createVolumeBuilder,
  createVpcBuilder,
  type VolumeBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { createTopicBuilder } from "@composurecdk/sns";

/**
 * A VPC + EC2 instance with a persistent EBS data volume attached at
 * `/dev/sdf`, all composed into a single stack alongside an SNS alert
 * topic.
 *
 * Demonstrates:
 * - {@link createVolumeBuilder} with well-architected defaults (GP3,
 *   encrypted at rest, `RemovalPolicy.RETAIN`).
 * - Wiring the volume's AZ to a sibling `VpcBuilder` via
 *   `ref<VpcBuilderResult>("network").map(...)`.
 * - {@link createInstanceBuilder}'s `attachVolume` method producing a
 *   first-class `AWS::EC2::VolumeAttachment` and a per-attachment
 *   `volumeStalledIo` alarm.
 * - Routing every alarm (instance + per-attachment) to a single SNS
 *   topic via `alarmActionsPolicy` — no extra wiring needed for the
 *   namespaced attachment alarm keys.
 *
 * NAT gateways are disabled to keep deploy/destroy fast and cheap.
 */
export function createAgentVolumeApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-AgentVolumeStack");

  const { alerts } = compose(
    {
      alerts: createTopicBuilder().displayName("Agent Volume Alerts"),

      network: createVpcBuilder().maxAzs(2).natGateways(0),

      data: createVolumeBuilder()
        .availabilityZone(
          ref<VpcBuilderResult>("network").map(
            (r: VpcBuilderResult): string => r.vpc.availabilityZones[0],
          ),
        )
        .size(Size.gibibytes(20)),

      agent: createInstanceBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .attachVolume("AgentData", ref<VolumeBuilderResult>("data"), {
          device: "/dev/sdf",
        }),
    },
    {
      alerts: [],
      network: [],
      data: ["network"],
      agent: ["network", "data"],
    },
  ).build(stack, "AgentVolumeApp");

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
