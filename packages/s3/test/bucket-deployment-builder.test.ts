import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Source } from "aws-cdk-lib/aws-s3-deployment";
import { Ref } from "@composurecdk/core";
import { createBucketDeploymentBuilder } from "../src/bucket-deployment-builder.js";
import { BUCKET_DEPLOYMENT_DEFAULTS } from "../src/bucket-deployment-defaults.js";

function createStack(): Stack {
  return new Stack(new App(), "TestStack");
}

describe("BucketDeploymentBuilder", () => {
  describe("build", () => {
    it("returns a BucketDeploymentBuilderResult with a deployment property", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      const result = createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      expect(result).toBeDefined();
      expect(result.deployment).toBeDefined();
    });

    it("creates a BucketDeployment resource in the template", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.resourceCountIs("Custom::CDKBucketDeployment", 1);
    });

    it("deploys to the specified destination bucket", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::CDKBucketDeployment", {
        DestinationBucketName: { Ref: stack.getLogicalId(bucket.node.defaultChild as never) },
      });
    });
  });

  describe("validation", () => {
    it("throws when no destination bucket is set", () => {
      const stack = createStack();

      expect(() =>
        createBucketDeploymentBuilder()
          .sources([Source.asset("./test")])
          .build(stack, "Deploy"),
      ).toThrow(/requires a destination bucket/);
    });

    it("throws when no sources are set", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      expect(() =>
        createBucketDeploymentBuilder().destinationBucket(bucket).build(stack, "Deploy"),
      ).toThrow(/requires at least one source/);
    });

    it("throws when sources array is empty", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      expect(() =>
        createBucketDeploymentBuilder()
          .sources([])
          .destinationBucket(bucket)
          .build(stack, "Deploy"),
      ).toThrow(/requires at least one source/);
    });
  });

  describe("Ref resolution", () => {
    it("resolves a Ref for destinationBucket", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      const bucketRef = Ref.to<{ bucket: Bucket }>("site").get("bucket");

      const result = createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucketRef)
        .build(stack, "Deploy", { site: { bucket } });

      expect(result.deployment).toBeDefined();
    });

    it("resolves a Ref for distribution", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");
      const distribution = new Distribution(stack, "CDN", {
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(bucket),
        },
      });

      const distRef = Ref.to<{ distribution: Distribution }>("cdn").get("distribution");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .distribution(distRef)
        .build(stack, "Deploy", { cdn: { distribution } });

      const template = Template.fromStack(stack);
      template.resourceCountIs("Custom::CDKBucketDeployment", 1);
    });
  });

  describe("distribution", () => {
    it("works without a distribution", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      const result = createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      expect(result.deployment).toBeDefined();
    });

    it("accepts a concrete distribution", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");
      const distribution = new Distribution(stack, "CDN", {
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(bucket),
        },
      });

      const result = createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .distribution(distribution)
        .build(stack, "Deploy");

      expect(result.deployment).toBeDefined();
    });
  });

  describe("defaults", () => {
    it("applies default distributionPaths", () => {
      expect(BUCKET_DEPLOYMENT_DEFAULTS.distributionPaths).toEqual(["/*"]);
    });

    it("enables pruning by default", () => {
      expect(BUCKET_DEPLOYMENT_DEFAULTS.prune).toBe(true);
    });

    it("sets memoryLimit to 256 MiB by default", () => {
      expect(BUCKET_DEPLOYMENT_DEFAULTS.memoryLimit).toBe(256);
    });

    it("disables retainOnDelete by default", () => {
      expect(BUCKET_DEPLOYMENT_DEFAULTS.retainOnDelete).toBe(false);
    });

    it("does not apply distributionPaths when no distribution is set", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::CDKBucketDeployment", {
        DistributionPaths: Match.absent(),
      });
    });
  });

  describe("property overrides", () => {
    it("allows overriding distributionPaths", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");
      const distribution = new Distribution(stack, "CDN", {
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(bucket),
        },
      });

      const result = createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .distribution(distribution)
        .distributionPaths(["/index.html"])
        .build(stack, "Deploy");

      expect(result.deployment).toBeDefined();
    });

    it("allows overriding prune", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .prune(false)
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::CDKBucketDeployment", {
        Prune: false,
      });
    });

    it("allows setting destinationKeyPrefix", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .destinationKeyPrefix("admin/")
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::CDKBucketDeployment", {
        DestinationBucketKeyPrefix: "admin/",
      });
    });
  });

  describe("logging", () => {
    it("creates a managed LogGroup by default", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("returns the auto-created LogGroup in the build result", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      const result = createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      expect(result.logGroup).toBeDefined();
    });

    it("applies RETAIN removal policy on the auto-created LogGroup", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.hasResource("AWS::Logs::LogGroup", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });

    it("applies TWO_YEARS retention on the auto-created LogGroup", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");

      createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .build(stack, "Deploy");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 731,
      });
    });

    it("skips auto LogGroup when user provides their own", () => {
      const stack = createStack();
      const bucket = new Bucket(stack, "Bucket");
      const userLogGroup = new LogGroup(stack, "UserLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      });

      const result = createBucketDeploymentBuilder()
        .sources([Source.asset("./test")])
        .destinationBucket(bucket)
        .logGroup(userLogGroup)
        .build(stack, "Deploy");

      expect(result.logGroup).toBeUndefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 7,
      });
    });
  });
});
