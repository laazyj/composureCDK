import { Stack } from "aws-cdk-lib";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";

/** Builds a VPC with isolated subnets — Neptune is VPC-only and needs no egress. */
export function isolatedVpc(stack: Stack): Vpc {
  return new Vpc(stack, "Vpc", {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
}
