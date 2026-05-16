"use strict";

// A tiny CDK app consumed entirely through `require()` under a
// `"type": "commonjs"` package — the exact scenario that motivated dual
// publishing (issue #119): `cdk synth` from a ts-node/Jest CJS app. Composes a
// ref-wired system and synthesizes it; a resolution or dual-package-hazard
// failure surfaces as a non-zero exit.

const { App } = require("aws-cdk-lib");
const { InstanceClass, InstanceSize, InstanceType, MachineImage } = require("aws-cdk-lib/aws-ec2");
const { compose, ref } = require("@composurecdk/core");
const { createStackBuilder } = require("@composurecdk/cloudformation");
const { createVpcBuilder, createInstanceBuilder } = require("@composurecdk/ec2");

const app = new App();
const { stack } = createStackBuilder().build(app, "ComposureCDK-ModuleCompatCjs");

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
