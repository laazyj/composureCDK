import { describe, it, expect } from "vitest";
import { App, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { createBucketBuilder } from "../src/bucket-builder.js";

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
  return builder.serverAccessLogs(false);
}

/** Returns the auto-created logging bucket — the one without a LoggingConfiguration. */
function findLogBucket(template: Template): {
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
} {
  const buckets = template.findResources("AWS::S3::Bucket", {
    Properties: { LoggingConfiguration: Match.absent() },
  });
  return Object.values(buckets)[0] as {
    Properties: Record<string, unknown>;
    DeletionPolicy?: string;
  };
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

      builder.serverAccessLogs({ destination: userLogBucket });

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

    it("aborts incomplete multipart uploads after 7 days by default", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Status: "Enabled",
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
            }),
          ]),
        },
      });
    });

    it("expires noncurrent object versions after 365 days by default", () => {
      const template = synthTemplate((b) => withoutLogging(b));

      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Status: "Enabled",
              NoncurrentVersionExpiration: { NoncurrentDays: 365 },
            }),
          ]),
        },
      });
    });

    it("allows the user to replace the default lifecycle rules", () => {
      const template = synthTemplate((b) =>
        withoutLogging(b).lifecycleRules([{ id: "CustomExpire", expiration: Duration.days(30) }]),
      );

      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: [
            Match.objectLike({
              Id: "CustomExpire",
              ExpirationInDays: 30,
            }),
          ],
        },
      });
    });
  });

  describe("access logging", () => {
    it("creates an access logging bucket by default", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      template.resourceCountIs("AWS::S3::Bucket", 2);
    });

    it("configures server access logs on the main bucket with the default prefix", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      template.hasResourceProperties("AWS::S3::Bucket", {
        LoggingConfiguration: {
          DestinationBucketName: Match.anyValue(),
          LogFilePrefix: "logs/",
        },
      });
    });

    it("allows the user to override the access logs prefix", () => {
      const template = synthTemplate((b) =>
        b.bucketName("main").serverAccessLogs({ prefix: "custom/" }),
      );

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
      builder.serverAccessLogs({ destination: userLogBucket });
      builder.build(stack, "TestBucket");
      const template = Template.fromStack(stack);

      // Only the user-provided log bucket + the main bucket exist, no auto-created one
      template.resourceCountIs("AWS::S3::Bucket", 2);
    });

    it("wires the user-provided destination and prefix onto the main bucket", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogBucket = new Bucket(stack, "UserLogBucket");
      const builder = createBucketBuilder();
      builder.serverAccessLogs({ destination: userLogBucket, prefix: "byo/" });
      builder.build(stack, "TestBucket");
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::S3::Bucket", {
        LoggingConfiguration: {
          DestinationBucketName: Match.anyValue(),
          LogFilePrefix: "byo/",
        },
      });
    });

    it("disables versioning on the auto-created logging bucket", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      const logBucket = findLogBucket(template);
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

      const logBucket = findLogBucket(template);
      expect(logBucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(logBucket.DeletionPolicy).toBe("Retain");
    });

    it("expires access log objects after 2 years on the auto-created logging bucket", () => {
      const template = synthTemplate((b) => b.bucketName("main"));

      const buckets = template.findResources("AWS::S3::Bucket", {
        Properties: {
          LoggingConfiguration: Match.absent(),
        },
      });
      const logBucket = Object.values(buckets)[0] as {
        Properties: { LifecycleConfiguration?: { Rules: Record<string, unknown>[] } };
      };
      const rules = logBucket.Properties.LifecycleConfiguration?.Rules ?? [];

      const expirationRule = rules.find((r) => r.ExpirationInDays !== undefined);
      expect(expirationRule).toBeDefined();
      expect(expirationRule?.ExpirationInDays).toBe(731);

      const abortRule = rules.find((r) => r.AbortIncompleteMultipartUpload !== undefined);
      expect(abortRule).toBeDefined();
      expect(abortRule?.AbortIncompleteMultipartUpload).toEqual({ DaysAfterInitiation: 7 });

      // Logging bucket is not versioned, so the noncurrent-version rule should not apply.
      const noncurrentRule = rules.find((r) => r.NoncurrentVersionExpiration !== undefined);
      expect(noncurrentRule).toBeUndefined();
    });
  });

  describe("validation", () => {
    it("throws when serverAccessLogs combines a destination with a configure callback", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogBucket = new Bucket(stack, "UserLogBucket");
      const builder = createBucketBuilder().serverAccessLogs({
        destination: userLogBucket,
        configure: (b) => b,
      });

      expect(() => builder.build(stack, "TestBucket")).toThrow(
        /'configure' cannot be combined with 'destination'/,
      );
    });
  });

  describe("serverAccessLogs configure callback", () => {
    it("applies user-supplied lifecycle rules to the auto-created logging bucket", () => {
      const template = synthTemplate((b) =>
        b.bucketName("main").serverAccessLogs({
          configure: (sub) =>
            sub.lifecycleRules([{ id: "ShortLogs", expiration: Duration.days(30) }]),
        }),
      );

      const logBucket = findLogBucket(template);
      const lifecycle = logBucket.Properties.LifecycleConfiguration as
        | { Rules: Record<string, unknown>[] }
        | undefined;
      const rules = lifecycle?.Rules ?? [];
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ Id: "ShortLogs", ExpirationInDays: 30 });
    });

    it("allows the configure callback to override the removal policy", () => {
      const template = synthTemplate((b) =>
        b.bucketName("main").serverAccessLogs({
          configure: (sub) => sub.removalPolicy(RemovalPolicy.DESTROY),
        }),
      );

      expect(findLogBucket(template).DeletionPolicy).toBe("Delete");
    });

    it("allows the configure callback to override encryption on the logging bucket", () => {
      const template = synthTemplate((b) =>
        b.bucketName("main").serverAccessLogs({
          configure: (sub) => sub.encryption(BucketEncryption.KMS_MANAGED),
        }),
      );

      const encryption = findLogBucket(template).Properties.BucketEncryption as {
        ServerSideEncryptionConfiguration: {
          ServerSideEncryptionByDefault: { SSEAlgorithm: string };
        }[];
      };
      expect(
        encryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm,
      ).toBe("aws:kms");
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

  describe("tagging", () => {
    it("applies builder tags to the primary bucket", () => {
      const template = synthTemplate((b) =>
        withoutLogging(b).tag("Project", "claude-rig").tag("Owner", "platform"),
      );

      const buckets = template.findResources("AWS::S3::Bucket") as Record<
        string,
        { Properties: { Tags?: { Key: string; Value: string }[] } }
      >;
      const tags = Object.values(buckets)[0]?.Properties.Tags ?? [];
      expect(tags).toEqual(
        expect.arrayContaining([
          { Key: "Project", Value: "claude-rig" },
          { Key: "Owner", Value: "platform" },
        ]),
      );
    });

    it("does not crash when a sibling result field is undefined", () => {
      const template = synthTemplate((b) => withoutLogging(b).tag("Project", "claude-rig"));

      const buckets = template.findResources("AWS::S3::Bucket") as Record<
        string,
        { Properties: { Tags?: { Key: string; Value: string }[] } }
      >;
      expect(Object.keys(buckets)).toHaveLength(1);
      expect(Object.values(buckets)[0]?.Properties.Tags).toEqual(
        expect.arrayContaining([{ Key: "Project", Value: "claude-rig" }]),
      );
    });

    it("applies builder tags to the auto-created access logs bucket sibling", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      createBucketBuilder().tag("Project", "claude-rig").build(stack, "TestBucket");

      const template = Template.fromStack(stack);
      // Both buckets — the primary and the auto-created access-logs sibling — carry the tag.
      const buckets = template.findResources("AWS::S3::Bucket");
      expect(Object.keys(buckets)).toHaveLength(2);
      for (const resource of Object.values(buckets) as {
        Properties: { Tags?: { Key: string; Value: string }[] };
      }[]) {
        expect(resource.Properties.Tags).toEqual(
          expect.arrayContaining([{ Key: "Project", Value: "claude-rig" }]),
        );
      }
    });

    it("applies builder tags to alarm constructs in the result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      createBucketBuilder()
        .serverAccessLogs(false)
        .tag("Owner", "platform")
        .addAlarm("requests", (alarm) =>
          alarm.metric(
            (bucket) =>
              new Metric({
                namespace: "AWS/S3",
                metricName: "AllRequests",
                dimensionsMap: { BucketName: bucket.bucketName },
              }),
          ),
        )
        .build(stack, "TestBucket");

      const template = Template.fromStack(stack);
      const alarms = template.findResources("AWS::CloudWatch::Alarm");
      expect(Object.keys(alarms).length).toBeGreaterThan(0);
      for (const resource of Object.values(alarms) as {
        Properties: { Tags?: { Key: string; Value: string }[] };
      }[]) {
        expect(resource.Properties.Tags).toEqual(
          expect.arrayContaining([{ Key: "Owner", Value: "platform" }]),
        );
      }
    });

    it("supports the .tags({...}) shorthand", () => {
      const template = synthTemplate((b) =>
        withoutLogging(b).tags({ Owner: "platform", Environment: "prod" }),
      );

      const buckets = template.findResources("AWS::S3::Bucket") as Record<
        string,
        { Properties: { Tags?: { Key: string; Value: string }[] } }
      >;
      const tags = Object.values(buckets)[0]?.Properties.Tags ?? [];
      expect(tags).toEqual(
        expect.arrayContaining([
          { Key: "Owner", Value: "platform" },
          { Key: "Environment", Value: "prod" },
        ]),
      );
    });
  });
});
