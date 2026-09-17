import { buildFixture } from "@composurecdk/cdk-testing";
import { InstanceClass, InstanceSize, InstanceType, MachineImage, Vpc } from "aws-cdk-lib/aws-ec2";
import { createInstanceBuilder } from "../src/instance-builder.js";

/**
 * Builds an instance into a stack that already has a VPC.
 *
 * Shared because `instance-builder` and `instance-alarms` need the identical
 * setup — an instance cannot be built without a VPC, an instance type and a
 * machine image, so every test in both files starts from the same three.
 * A test that cares about one of them overrides it in its `configure`
 * callback, which runs after this seed.
 */
export const buildInstance = buildFixture(createInstanceBuilder, "TestInstance", {
  seed: (b, stack) =>
    void b
      .vpc(new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 }))
      .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
      .machineImage(MachineImage.latestAmazonLinux2023()),
});
