import { describe, it, expect } from "vitest";
import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { createBucketBuilder } from "../src/bucket-builder.js";
import { BUCKET_DEFAULTS } from "../src/defaults.js";

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createBucketBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createBucketBuilder();
  configureFn(builder);
  builder.build(stack, "TestBucket");
  return Template.fromStack(stack);
}

/** Disables access logging so tests that don't need it get a single-bucket template. */
function withoutLogging(builder: ReturnType<typeof createBucketBuilder>) {
  return builder.accessLogging(false);
}

describe("BucketBuilder", () => {
  describe("build", () => {
    it("returns a BucketBuilderResult with a bucket property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createBucketBuilder();

      const result = builder.build(stack, "TestBucket");

      expect(result).toBeDefined();
      expect(result.bucket).toBeDefined();
    });

    it("returns the auto-created access logs bucket in the result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createBucketBuilder();

      const result = builder.build(stack, "TestBucket");

      expect(result.accessLogsBucket).toBeDefined();
    });

    it("returns undefined accessLogsBucket when access logging is disabled", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createBucketBuilder();

      withoutLogging(builder);

      const result = builder.build(stack, "TestBucket");

      expect(result.accessLogsBucket).toBeUndefined();
    });

    it("returns undefined accessLogsBucket when user provides their own destination", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogBucket = new Bucket(stack, "UserLogBucket");
      const builder = createBucketBuilder();

      builder.serverAccessLogsBucket(userLogBucket);

      const result = builder.build(stack, "TestBucket");

      expect(result.accessLogsBucket).toBeUndefined();
    });
  });

  describe("synthesised output", () => {
    it("creates exactly one S3 bucket when access logging is disabled", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.resourceCountIs("AWS::S3::Bucket", 1);
    });

    it("creates a bucket with a custom name", () => {
      const template = synthTemplate((b) => withoutLogging(b).bucketName("my-custom-bucket"));

      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: "my-custom-bucket",
      });
    });
  });

  describe("secure defaults", () => {
    it("blocks all public access by default", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it("enables S3-managed encryption by default", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
      });
    });

    it("enforces SSL by default", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: {
                Bool: { "aws:SecureTransport": "false" },
              },
            }),
          ]),
        },
      });
    });

    it("enables versioning by default", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.hasResourceProperties("AWS::S3::Bucket", {
        VersioningConfiguration: {
          Status: "Enabled",
        },
      });
    });

    it("retains the bucket on stack deletion by default", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.hasResource("AWS::S3::Bucket", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });

    it("allows the user to disable versioning", () => {
      const template = synthTemplate((b) => withoutLogging(b).versioned(false));

      // When versioned is false, CDK does not emit VersioningConfiguration
      template.hasResourceProperties("AWS::S3::Bucket", {});
    });
  });

  describe("access logging", () => {
    it("creates an access logging bucket by default", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      template.resourceCountIs("AWS::S3::Bucket", 2);
    });

    it("configures server access logs on the main bucket", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      template.hasResourceProperties("AWS::S3::Bucket", {
        LoggingConfiguration: {
          DestinationBucketName: Match.anyValue(),
          LogFilePrefix: BUCKET_DEFAULTS.accessLogsPrefix,
        },
      });
    });

    it("allows the user to override the access logs prefix", () => {
      const template = synthTemplate((b) => b.bucketName("main").accessLogsPrefix("custom/"));

      template.hasResourceProperties("AWS::S3::Bucket", {
        LoggingConfiguration: {
          DestinationBucketName: Match.anyValue(),
          LogFilePrefix: "custom/",
        },
      });
    });

    it("creates no logging bucket when access logging is disabled", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.resourceCountIs("AWS::S3::Bucket", 1);
    });

    it("skips auto logging bucket when user provides their own destination", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogBucket = new Bucket(stack, "UserLogBucket");
      const builder = createBucketBuilder();
      builder.serverAccessLogsBucket(userLogBucket);
      builder.build(stack, "TestBucket");
      const template = Template.fromStack(stack);

      // Only the user-provided log bucket + the main bucket exist, no auto-created one
      template.resourceCountIs("AWS::S3::Bucket", 2);
    });

    it("disables versioning on the auto-created logging bucket", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      const buckets = template.findResources("AWS::S3::Bucket", {
        Properties: {
          LoggingConfiguration: Match.absent(),
        },
      });
      const logBucket = Object.values(buckets)[0] as {
        Properties: Record<string, unknown>;
      };
      expect(logBucket.Properties.VersioningConfiguration).toBeUndefined();
    });

    it("disables access logging on the auto-created logging bucket", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      // Only the main bucket should have a LoggingConfiguration
      const bucketsWithLogging = template.findResources("AWS::S3::Bucket", {
        Properties: {
          LoggingConfiguration: Match.anyValue(),
        },
      });
      expect(Object.keys(bucketsWithLogging)).toHaveLength(1);
    });

    it("applies secure defaults to the auto-created logging bucket", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      // The logging bucket should have block public access and encryption
      const buckets = template.findResources("AWS::S3::Bucket", {
        Properties: {
          LoggingConfiguration: Match.absent(),
        },
      });
      const logBucket = Object.values(buckets)[0] as {
        Properties: Record<string, unknown>;
        DeletionPolicy: string;
      };
      expect(logBucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(logBucket.DeletionPolicy).toBe("Retain");
    });
  });

  describe("validation", () => {
    it("throws when accessLogsPrefix is set with accessLogging disabled", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createBucketBuilder().accessLogging(false).accessLogsPrefix("custom/");

      expect(() => builder.build(stack, "TestBucket")).toThrow(/Cannot set 'accessLogsPrefix'/);
    });

    it("throws when accessLogsPrefix is set with a user-provided logging bucket", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogBucket = new Bucket(stack, "UserLogBucket");
      const builder = createBucketBuilder()
        .serverAccessLogsBucket(userLogBucket)
        .accessLogsPrefix("custom/");

      expect(() => builder.build(stack, "TestBucket")).toThrow(/Cannot set 'accessLogsPrefix'/);
    });
  });

  describe("autoDeleteObjects", () => {
    it("enables autoDeleteObjects when removalPolicy is DESTROY", () => {
      const template = synthTemplate((b) => withoutLogging(b).removalPolicy(RemovalPolicy.DESTROY));

      template.hasResource("AWS::S3::Bucket", {
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
      });
      // autoDeleteObjects adds a custom resource for object cleanup
      template.resourceCountIs("Custom::S3AutoDeleteObjects", 1);
    });

    it("does not enable autoDeleteObjects when removalPolicy is RETAIN", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.resourceCountIs("Custom::S3AutoDeleteObjects", 0);
    });

    it("respects explicit autoDeleteObjects(false) with DESTROY policy", () => {
      const template = synthTemplate((b) =>
        withoutLogging(b).removalPolicy(RemovalPolicy.DESTROY).autoDeleteObjects(false),
      );

      template.resourceCountIs("Custom::S3AutoDeleteObjects", 0);
    });
  });
});
