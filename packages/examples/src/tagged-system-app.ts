import { App, Stack } from "aws-cdk-lib";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { tags } from "@composurecdk/cloudformation";
import { createInstanceBuilder, createVpcBuilder, type VpcBuilderResult } from "@composurecdk/ec2";
import { createBucketBuilder } from "@composurecdk/s3";

/**
 * A two-component system that demonstrates both layers of the tagging API.
 *
 * - **Layer 1** — `.tag(...)` on the EC2 instance applies a selector tag
 *   `Project=claude-rig`. Downstream IAM kill-switches with a
 *   `ec2:ResourceTag/Project = claude-rig` condition can target this
 *   specific instance without affecting siblings (S3, VPC, alarms).
 *
 * - **Layer 2** — `tags({ system: {...} })` applies ownership and
 *   environment tags across every taggable construct in the system,
 *   including the auto-created flow-log LogGroup, alarms, and the bucket.
 *   This covers cost allocation and operational ownership without
 *   per-builder configuration.
 *
 * Builder-level tags win on key collision because they target a closer
 * scope. Override `Owner: "platform"` on the instance via
 * `.tag("Owner", "...")` and the instance's tag will take precedence over
 * the system-wide value while siblings still get the system value.
 */
export function createTaggedSystemApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-TaggedSystemStack");

  compose(
    {
      assets: createBucketBuilder().serverAccessLogs(false),

      network: createVpcBuilder().maxAzs(2).natGateways(0),

      agent: createInstanceBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r): Vpc => r.vpc))
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .tag("Project", "claude-rig"),
    },
    { assets: [], network: [], agent: ["network"] },
  )
    .afterBuild(
      tags({
        system: {
          Owner: "platform",
          Environment: "prod",
          CostCenter: "1234",
        },
      }),
    )
    .build(stack, "TaggedSystem");

  return { stack };
}
