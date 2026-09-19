import { describe, expect, it } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { DatabaseCluster, InstanceType } from "@aws-cdk/aws-neptune-alpha";
import { assertCapabilitiesCovered, newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { clusterGrants } from "../src/grants.js";
import { isolatedVpc } from "./_helpers.js";

function setup(iamAuthentication = true) {
  const stack = newStack();
  const cluster = new DatabaseCluster(stack, "Graph", {
    vpc: isolatedVpc(stack),
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    instanceType: InstanceType.R6G_LARGE,
    iamAuthentication,
  });
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("ec2.amazonaws.com") });
  return { stack, cluster, role };
}

describe("clusterGrants", () => {
  it("covers every capability clusterGrants exposes", () => {
    assertCapabilitiesCovered(clusterGrants, ["connect"]);
  });

  it("connect delegates to the cluster's native grantConnect", () => {
    const { stack, cluster, role } = setup();

    clusterGrants.connect(cluster).applyTo(role, {});

    expect(policyJson(stack)).toContain("neptune-db:*");
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable cluster from the build context before granting", () => {
    const { stack, cluster, role } = setup();

    clusterGrants
      .connect(ref<{ cluster: DatabaseCluster }, DatabaseCluster>("graph", (r) => r.cluster))
      .applyTo(role, { graph: { cluster } });

    expect(policyJson(stack)).toContain("neptune-db:*");
  });

  it("surfaces the L2's own rejection when IAM authentication is disabled", () => {
    const { cluster, role } = setup(false);

    // The alpha L2 refuses to write a policy that could never authorise
    // anything, rather than emitting an inert one.
    expect(() => {
      clusterGrants.connect(cluster).applyTo(role, {});
    }).toThrow(/IAM authentication is disabled/);
  });
});
