import { describe, expect, it } from "vitest";
import { Tags } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { newStack } from "../src/stack.js";
import { policyJson, tagsPerResource } from "../src/template.js";

describe("policyJson", () => {
  it("stringifies the synthesised template, so a granted action is findable", () => {
    const stack = newStack();
    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });
    new Key(stack, "Key").grantDecrypt(role);

    expect(policyJson(stack)).toContain("kms:Decrypt");
  });
});

describe("tagsPerResource", () => {
  it("returns one tag set per matching resource, in template order", () => {
    const stack = newStack();
    Tags.of(new Bucket(stack, "A")).add("Owner", "platform");
    Tags.of(new Bucket(stack, "B")).add("Owner", "data");

    expect(tagsPerResource(Template.fromStack(stack), "AWS::S3::Bucket")).toEqual([
      [{ Key: "Owner", Value: "platform" }],
      [{ Key: "Owner", Value: "data" }],
    ]);
  });

  it("normalises a resource with no Tags property to an empty array", () => {
    const stack = newStack();
    new Bucket(stack, "Untagged");

    expect(tagsPerResource(Template.fromStack(stack), "AWS::S3::Bucket")).toEqual([[]]);
  });

  it("is empty when no resource of that type exists", () => {
    expect(tagsPerResource(Template.fromStack(newStack()), "AWS::S3::Bucket")).toEqual([]);
  });
});
