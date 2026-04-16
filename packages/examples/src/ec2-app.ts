import { App, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { createInstanceBuilder, createVpcBuilder, type VpcBuilderResult } from "@composurecdk/ec2";
import { createTopicBuilder } from "@composurecdk/sns";

/**
 * A VPC with an EC2 instance launched into its private subnet, composed
 * into a single stack alongside an SNS alert topic.
 *
 * Demonstrates:
 * - Creating a VPC with well-architected defaults (2 AZs, 1 NAT, flow logs)
 * - Creating an EC2 instance with well-architected defaults
 *   (IMDSv2, detailed monitoring, encrypted GP3 root, SSM-managed)
 * - Wiring the instance to the VPC via `ref<VpcBuilderResult>(...)` —
 *   no direct construct passing needed
 * - Recommended alarms (CPU, status check, CPU credit balance for T-family)
 * - Applying SNS alarm actions via afterBuild hook
 */
export function createEc2App(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-Ec2Stack");

  compose(
    {
      alerts: createTopicBuilder().displayName("EC2 Alerts"),

      network: createVpcBuilder().maxAzs(2).natGateways(1),

      server: createInstanceBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023()),
    },
    { alerts: [], network: [], server: ["network"] },
  )
    .afterBuild((_scope, _id, results) => {
      const action = new SnsAction(results.alerts.topic);
      for (const alarm of Object.values(results.server.alarms)) {
        alarm.addAlarmAction(action);
      }
    })
    .build(stack, "Ec2App");

  return { stack };
}
