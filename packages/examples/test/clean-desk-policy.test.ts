import { beforeAll, describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { MockIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { cleanDeskPolicy } from "../src/clean-desk-policy.js";
import { createMockApiApp } from "../src/mock-api-app.js";
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
    const { stack } = createMockApiApp(app);
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

  describe("disable-logging-on-delete aspect", () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      cleanDeskPolicy(app);
      const { stack } = createStaticWebsiteApp(app);
      template = Template.fromStack(stack);
    });

    it("creates a Custom::DisableBucketLogging for each bucket that is a server-access-logging source", () => {
      // Only the site bucket has serverAccessLogsBucket wired in the static
      // website stack (the S3 access-logs bucket and the CloudFront logs
      // bucket are destinations, not sources).
      template.resourceCountIs("Custom::DisableBucketLogging", 1);
    });

    it("scopes the IAM policy to s3:PutBucketLogging on the source bucket only", () => {
      template.hasResourceProperties(
        "AWS::IAM::Policy",
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: "s3:PutBucketLogging",
                Effect: "Allow",
                Resource: Match.objectLike({
                  "Fn::GetAtt": Match.arrayWith([Match.stringLikeRegexp("StaticWebsitesite")]),
                }),
              }),
            ]),
          }),
        }),
      );
    });

    it("encodes putBucketLogging with empty BucketLoggingStatus in the onDelete payload", () => {
      const resources = template.findResources("Custom::DisableBucketLogging");
      const [cr] = Object.values(resources);
      const deletePayload = (cr as { Properties: { Delete?: unknown } }).Properties.Delete;
      expect(deletePayload).toBeDefined();

      // AwsCustomResource inlines the SDK call as a JSON-stringified blob;
      // because `Bucket` is a Ref token, it's rendered as a `Fn::Join` whose
      // string segments contain the literal JSON. Serialise once and regex
      // to tolerate token interpolation.
      const serialized = JSON.stringify(deletePayload);
      expect(serialized).toContain("putBucketLogging");
      expect(serialized).toContain("BucketLoggingStatus");
    });

    it("orders the disable-logging CR before the source bucket's autoDelete CR", () => {
      // The disable-logging CR DependsOn the source's autoDelete CR. CFN
      // reverses create order on delete, so disableLoggingCR.onDelete fires
      // BEFORE source.autoDelete empties the source bucket — which is what
      // prevents the source-deletion DELETE calls from emitting access logs
      // that would race the logs-bucket teardown.
      const disableCrs = template.findResources("Custom::DisableBucketLogging");
      const [, disableCrResource] = Object.entries(disableCrs)[0] as [
        string,
        { DependsOn?: string[] },
      ];
      const autoDeletes = template.findResources("Custom::S3AutoDeleteObjects");
      const sourceAutoDeleteId = Object.keys(autoDeletes).find((logicalId) =>
        logicalId.startsWith("StaticWebsitesiteAutoDelete"),
      );
      expect(sourceAutoDeleteId).toBeDefined();
      expect(disableCrResource.DependsOn).toContain(sourceAutoDeleteId);
    });

    it("adds no disable-logging CR for stacks without server access logging", () => {
      const app = new App();
      cleanDeskPolicy(app);
      const { stack } = createMockApiApp(app);
      const mockApiTemplate = Template.fromStack(stack);

      mockApiTemplate.resourceCountIs("Custom::DisableBucketLogging", 0);
    });
  });
});
