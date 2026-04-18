import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { MockIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { cleanDeskPolicy } from "../src/clean-desk-policy.js";
import { createLambdaApiApp } from "../src/lambda-api-app.js";
import { createStaticWebsiteApp } from "../src/static-website/app.js";

function buildWithPolicy(buildFn: (stack: Stack) => void): Template {
  const app = new App();
  cleanDeskPolicy(app);
  const stack = new Stack(app, "TestStack");
  buildFn(stack);
  return Template.fromStack(stack);
}

describe("cleanDeskPolicy", () => {
  it("overrides S3 bucket removal policy to DESTROY", () => {
    const template = buildWithPolicy((stack) => {
      new Bucket(stack, "Bucket");
    });

    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("overrides LogGroup removal policy to DESTROY", () => {
    const template = buildWithPolicy((stack) => {
      new LogGroup(stack, "LG", { retention: RetentionDays.ONE_WEEK });
    });

    template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("overrides RestApi Account and CloudWatch Role removal policy to DESTROY", () => {
    const template = buildWithPolicy((stack) => {
      const api = new RestApi(stack, "Api", { restApiName: "TestApi" });
      api.root.addMethod("GET", new MockIntegration());
    });

    template.hasResource("AWS::ApiGateway::Account", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("does not affect stacks without the policy", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new Bucket(stack, "Bucket");
    new LogGroup(stack, "LG", { retention: RetentionDays.ONE_WEEK });
    const template = Template.fromStack(stack);

    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
    template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("sets all resources to Delete in a full example stack", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createLambdaApiApp(app);
    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { DeletionPolicy?: string }>;

    const retainedResources = Object.entries(resources)
      .filter(([, resource]) => resource.DeletionPolicy === "Retain")
      .map(([logicalId]) => logicalId);

    expect(retainedResources).toEqual([]);
  });

  it("sets all resources to Delete in the static website stack", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createStaticWebsiteApp(app);
    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { DeletionPolicy?: string }>;

    const retainedResources = Object.entries(resources)
      .filter(([, resource]) => resource.DeletionPolicy === "Retain")
      .map(([logicalId]) => logicalId);

    expect(retainedResources).toEqual([]);
  });

  it("sets CloudFront access logs bucket to Delete when cleanDeskPolicy is applied", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createStaticWebsiteApp(app);
    const template = Template.fromStack(stack);
    const buckets = template.findResources("AWS::S3::Bucket");

    // All 3 buckets (site, S3 access logs, CloudFront access logs) should have Delete policy
    const bucketPolicies = Object.values(buckets).map(
      (bucket) => (bucket as { DeletionPolicy?: string }).DeletionPolicy,
    );

    expect(bucketPolicies).toEqual(["Delete", "Delete", "Delete"]);
  });

  it("creates autoDeleteObjects custom resources for all buckets when cleanDeskPolicy is applied", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createStaticWebsiteApp(app);
    const template = Template.fromStack(stack);

    const buckets = template.findResources("AWS::S3::Bucket");
    const autoDeleteResources = template.findResources("Custom::S3AutoDeleteObjects");

    // Should have 3 buckets and 3 autoDelete custom resources
    expect(Object.keys(buckets).length).toBe(3);
    expect(Object.keys(autoDeleteResources).length).toBe(3);

    // Each bucket should have a corresponding autoDelete resource
    const bucketIds = Object.keys(buckets);
    const autoDeleteBucketRefs = Object.values(autoDeleteResources).map(
      (resource) =>
        (resource as { Properties?: { BucketName?: { Ref?: string } } }).Properties?.BucketName
          ?.Ref,
    );

    for (const bucketId of bucketIds) {
      expect(autoDeleteBucketRefs).toContain(bucketId);
    }
  });
});
