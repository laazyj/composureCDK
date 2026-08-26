import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { DatabaseCluster, InstanceType } from "@aws-cdk/aws-neptune-alpha";
import { ref } from "@composurecdk/core";
import { clusterGrants } from "../src/grants.js";

function setup(iamAuthentication = true) {
  const app = new App();
  const stack = new Stack(app, "S");
  const vpc = new Vpc(stack, "Vpc", {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
  const cluster = new DatabaseCluster(stack, "Graph", {
    vpc,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    instanceType: InstanceType.R6G_LARGE,
    iamAuthentication,
  });
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("ec2.amazonaws.com") });
  return { stack, cluster, role };
}

// The granted actions land on the role's policy; asserting on the rendered
// template keeps us decoupled from CDK's exact statement shape.
const policyJson = (stack: Stack) => JSON.stringify(Template.fromStack(stack).toJSON());

describe("clusterGrants", () => {
  it("connect delegates to the cluster's native grantConnect", () => {
    const { stack, cluster, role } = setup();

    clusterGrants.connect(cluster).applyTo(role, {});

    expect(policyJson(stack)).toContain("neptune-db:*");
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("dataAccess grants only the named actions", () => {
    const { stack, cluster, role } = setup();

    clusterGrants
      .dataAccess(cluster, "neptune-db:ReadDataViaQuery", "neptune-db:GetEngineStatus")
      .applyTo(role, {});

    const json = policyJson(stack);
    expect(json).toContain("neptune-db:ReadDataViaQuery");
    expect(json).toContain("neptune-db:GetEngineStatus");
    expect(json).not.toContain("neptune-db:*");
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
