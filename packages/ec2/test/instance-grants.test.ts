import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { InstanceClass, InstanceSize, InstanceType, MachineImage, Vpc } from "aws-cdk-lib/aws-ec2";
import { type IGrantable, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { newStack } from "@composurecdk/cdk-testing";
import { compose, grantVia, type Lifecycle, ref, type Resolvable } from "@composurecdk/core";
import { createInstanceBuilder } from "../src/instance-builder.js";

// A write grant on a real Bucket, built the same way a resource package's
// capability helper (bucketGrants.write) does — grant() is resource-agnostic,
// so exercising a real construct's native grantWrite is the faithful check.
const writeBucket = (bucket: Resolvable<Bucket>) =>
  grantVia(bucket, (b: Bucket, grantee: IGrantable) => {
    b.grantWrite(grantee);
  });

const instance = () =>
  createInstanceBuilder()
    .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
    .machineImage(MachineImage.latestAmazonLinux2023())
    .recommendedAlarms(false);

/**
 * Asserts the s3 write actions were granted, and that the policy attaches to
 * the role whose logical id matches `roleId` — the point of the grant is not
 * just that a policy exists, but that it lands on the role the instance runs
 * as.
 */
const expectWritePolicyOnRole = (template: Template, roleId: string): void => {
  template.hasResourceProperties("AWS::IAM::Policy", {
    Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp(roleId) })]),
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: Match.arrayWith([Match.stringLikeRegexp("s3:PutObject")]) }),
      ]),
    }),
  });
};

describe("InstanceBuilder.grant", () => {
  it("applies grants to the instance itself, not to a role the builder resolved", () => {
    const stack = newStack();
    const vpc = new Vpc(stack, "Vpc", { maxAzs: 2, natGateways: 0 });
    const role = new Role(stack, "ProvidedRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });
    let grantee: IGrantable | undefined;

    const { instance: built } = instance()
      .vpc(vpc)
      .role(ref<{ role: Role }>("iam").get("role"))
      .grant({
        applyTo: (g) => {
          grantee = g;
        },
      })
      .build(stack, "Server", { iam: { role } });

    // The grantee is the construct, so the policy follows whichever role the
    // instance ends up running as. That includes `instanceProfile.role`, which
    // CDK prefers over `props.role` and which this package never resolves
    // itself — resolving the role here instead would silently miss it. (That
    // path cannot be exercised end to end: `InstanceProps.instanceProfile` does
    // not exist at this package's aws-cdk-lib floor, so a `.instanceProfile()`
    // call does not typecheck under `cdk-floors enforce`.)
    expect(grantee).toBe(built);
  });

  it("applies a grant to the role CDK creates for the instance", () => {
    const stack = newStack();
    const vpc = new Vpc(stack, "Vpc", { maxAzs: 2, natGateways: 0 });
    const bucket = new Bucket(stack, "Bucket");

    instance().vpc(vpc).grant(writeBucket(bucket)).build(stack, "Server");

    const template = Template.fromStack(stack);
    // No role component is needed for a grant: the instance's own auto-created
    // role is the grantee, and it is the only role in the stack.
    template.resourceCountIs("AWS::IAM::Role", 1);
    expectWritePolicyOnRole(template, "ServerInstanceRole");
  });

  it("applies a grant to an externally supplied role", () => {
    const stack = newStack();
    const vpc = new Vpc(stack, "Vpc", { maxAzs: 2, natGateways: 0 });
    const bucket = new Bucket(stack, "Bucket");
    const role = new Role(stack, "ProvidedRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });

    instance()
      .vpc(vpc)
      .role(ref<{ role: Role }>("iam").get("role"))
      .grant(writeBucket(bucket))
      .build(stack, "Server", { iam: { role } });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::Role", 1);
    expectWritePolicyOnRole(template, "ProvidedRole");
  });

  it("resolves a ref grant through compose context, edge pointing instance -> resource", () => {
    const stack = newStack();
    const vpc = new Vpc(stack, "Vpc", { maxAzs: 2, natGateways: 0 });

    const store: Lifecycle<{ bucket: Bucket }> = {
      build: (scope, id) => ({ bucket: new Bucket(scope, id) }),
    };
    const server = instance()
      .vpc(vpc)
      .grant(writeBucket(ref<{ bucket: Bucket }, Bucket>("store", (r) => r.bucket)));

    // server depends on store (server: ["store"]) — the grant follows the
    // data-flow edge and composes without a cycle.
    expect(() =>
      compose({ store, server }, { store: [], server: ["store"] }).build(stack, "Sys"),
    ).not.toThrow();

    expectWritePolicyOnRole(Template.fromStack(stack), "InstanceRole");
  });

  it("preserves queued grants across .copy()", () => {
    const stack = newStack();
    const vpc = new Vpc(stack, "Vpc", { maxAzs: 2, natGateways: 0 });
    const bucket = new Bucket(stack, "Bucket");

    instance().vpc(vpc).grant(writeBucket(bucket)).copy().build(stack, "CopiedServer");

    expectWritePolicyOnRole(Template.fromStack(stack), "CopiedServerInstanceRole");
  });
});
