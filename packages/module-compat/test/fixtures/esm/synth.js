// A tiny CDK app consumed entirely through `import` under a `"type": "module"`
// package — the ESM counterpart to ../cjs/synth.js. Composes a ref-wired system
// and synthesizes it; a resolution failure surfaces as a non-zero exit.

import { App } from "aws-cdk-lib";
import { InstanceClass, InstanceSize, InstanceType, MachineImage } from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { createStackBuilder } from "@composurecdk/cloudformation";
import { createVpcBuilder, createInstanceBuilder } from "@composurecdk/ec2";

const app = new App();
const { stack } = createStackBuilder().build(app, "ComposureCDK-ModuleCompatEsm");

compose(
  {
    network: createVpcBuilder().maxAzs(2).natGateways(0),
    agent: createInstanceBuilder()
      .vpc(ref("network").map((r) => r.vpc))
      .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
      .machineImage(MachineImage.latestAmazonLinux2023()),
  },
  { network: [], agent: ["network"] },
).build(stack, "System");

app.synth();
