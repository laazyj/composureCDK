import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { ref } from "@composurecdk/core";
import { bucketGrants } from "../src/grants.js";

function setup() {
  const app = new App();
  const stack = new Stack(app, "S");
  const bucket = new Bucket(stack, "Bucket");
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, bucket, role };
}

const policyJson = (stack: Stack) => JSON.stringify(Template.fromStack(stack).toJSON());

describe("bucketGrants", () => {
  it.each([
    ["read", ["s3:GetObject"]],
    ["write", ["s3:PutObject"]],
    ["readWrite", ["s3:GetObject", "s3:PutObject"]],
    ["put", ["s3:PutObject"]],
    ["delete", ["s3:DeleteObject"]],
  ] as const)("%s delegates to the matching native grant method", (capability, actions) => {
    const { stack, bucket, role } = setup();

    bucketGrants[capability](bucket).applyTo(role, {});

    const json = policyJson(stack);
    for (const action of actions) expect(json).toContain(action);
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable bucket from the build context before granting", () => {
    const { stack, bucket, role } = setup();

    bucketGrants
      .write(ref<{ bucket: Bucket }, Bucket>("store", (r) => r.bucket))
      .applyTo(role, { store: { bucket } });

    expect(policyJson(stack)).toContain("s3:PutObject");
  });
});
