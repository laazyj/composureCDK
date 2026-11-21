import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Distribution, type IDistribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { buildFixture, newStack, TEST_ACCOUNT, testEnv } from "@composurecdk/cdk-testing";
import { compose, ref } from "@composurecdk/core";
import { type BucketBuilderResult, createBucketBuilder } from "@composurecdk/s3";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createDistributionBuilder } from "../src/distribution-builder.js";
import {
  type CloudFrontLogDeliveryBuilderProps,
  createCloudFrontLogDeliveryBuilder,
  type StandardLoggingConfig,
} from "../src/standard-logging.js";

const ORIGIN = new HttpOrigin("origin.example.com");

const buildAndSynth = buildFixture(
  () => createDistributionBuilder().origin(ORIGIN),
  "TestDistribution",
  { stackProps: { env: testEnv("us-east-1") } },
);

/**
 * `accessLogs({ v2 })` with the delivery builder configured from `props`,
 * through the `configure` callback a user would write.
 */
function v2(props: CloudFrontLogDeliveryBuilderProps = {}): { v2: StandardLoggingConfig } {
  return {
    v2: {
      configure: (d) =>
        d
          .destination(props.destination)
          .outputFormat(props.outputFormat)
          .s3EnableHiveCompatiblePath(props.s3EnableHiveCompatiblePath),
    },
  };
}

function withV2(props: CloudFrontLogDeliveryBuilderProps = {}) {
  return buildAndSynth((b) => b.accessLogs(v2(props)));
}

interface CfnResourceJson {
  Properties: Record<string, unknown>;
  DependsOn?: string[];
}

function resources(template: Template, type: string): Record<string, CfnResourceJson> {
  return template.findResources(type) as Record<string, CfnResourceJson>;
}

interface Statement {
  Principal?: { Service?: string };
  [key: string]: unknown;
}

function bucketPolicyStatement(template: Template): Statement {
  const statement = Object.values(resources(template, "AWS::S3::BucketPolicy"))
    .flatMap((p) => (p.Properties.PolicyDocument as { Statement: Statement[] }).Statement)
    .find((s) => s.Principal?.Service === "delivery.logs.amazonaws.com");
  if (!statement) throw new Error("no log-delivery statement in any bucket policy");
  return statement;
}

describe("accessLogs({ v2 })", () => {
  describe("default S3 destination", () => {
    it("auto-creates an ACL-free bucket", () => {
      const { template, result } = withV2();

      template.resourceCountIs("AWS::S3::Bucket", 1);
      template.hasResourceProperties("AWS::S3::Bucket", {
        OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
        AccessControl: Match.absent(),
      });
      template.hasResource("AWS::S3::Bucket", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
      expect(result.accessLogsBucket).toBeDefined();
    });

    it("turns off legacy logging on the distribution", () => {
      const { template } = withV2();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({ Logging: Match.absent() }),
      });
    });

    it("creates an ACCESS_LOGS delivery source for the distribution", () => {
      const { template } = withV2();
      template.hasResourceProperties("AWS::Logs::DeliverySource", {
        LogType: "ACCESS_LOGS",
        ResourceArn: {
          "Fn::Join": [
            "",
            [
              "arn:",
              { Ref: "AWS::Partition" },
              `:cloudfront::${TEST_ACCOUNT}:distribution/`,
              { Ref: Match.stringLikeRegexp("^TestDistribution") },
            ],
          ],
        },
      });
    });

    it("writes w3c to the auto-created bucket by default", () => {
      const { template } = withV2();
      template.hasResourceProperties("AWS::Logs::DeliveryDestination", {
        OutputFormat: "w3c",
        DestinationResourceArn: {
          "Fn::GetAtt": [Match.stringLikeRegexp("TestDistributionLogDeliveryBucket"), "Arn"],
        },
      });
    });

    it("grants delivery through the bucket policy, scoped to the source", () => {
      const { template, result } = withV2();
      const sourceName = result.logDelivery?.source.name ?? "";

      expect(bucketPolicyStatement(template)).toEqual({
        Effect: "Allow",
        Principal: { Service: "delivery.logs.amazonaws.com" },
        Action: "s3:PutObject",
        Resource: {
          "Fn::Join": [
            "",
            [
              { "Fn::GetAtt": [expect.stringMatching(/LogDeliveryBucket/), "Arn"] },
              "/AWSLogs/",
              { Ref: "AWS::AccountId" },
              "/CloudFront/*",
            ],
          ],
        },
        Condition: {
          StringEquals: {
            "aws:SourceAccount": { Ref: "AWS::AccountId" },
            "s3:x-amz-acl": "bucket-owner-full-control",
          },
          ArnLike: {
            "aws:SourceArn": {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  { Ref: "AWS::Partition" },
                  ":logs:us-east-1:",
                  { Ref: "AWS::AccountId" },
                  `:delivery-source:${sourceName}`,
                ],
              ],
            },
          },
        },
      });
    });

    it("makes the delivery wait for its source and the bucket policy", () => {
      const { template, result } = withV2();
      const [[sourceId, source]] = Object.entries(resources(template, "AWS::Logs::DeliverySource"));
      const [policyId] = Object.keys(resources(template, "AWS::S3::BucketPolicy"));
      const [delivery] = Object.values(resources(template, "AWS::Logs::Delivery"));

      expect(delivery.DependsOn).toEqual(expect.arrayContaining([sourceId, policyId]));
      expect(delivery.Properties.DeliverySourceName).toBe(source.Properties.Name);
      expect(result.logDelivery?.source.name).toMatch(/^[\w-]{1,60}$/);
    });

    it("deletes the delivery before an auto-delete custom resource empties the bucket", () => {
      const { template } = withV2({
        destination: {
          s3: {
            configure: (b) => b.removalPolicy(RemovalPolicy.DESTROY).autoDeleteObjects(true),
          },
        },
      });
      const [autoDeleteId] = Object.keys(resources(template, "Custom::S3AutoDeleteObjects"));
      const [delivery] = Object.values(resources(template, "AWS::Logs::Delivery"));

      expect(delivery.DependsOn).toContain(autoDeleteId);
    });

    it("leaves legacy logging untouched when v2 is not chosen", () => {
      const { template, result } = buildAndSynth((b) => b);
      template.resourceCountIs("AWS::Logs::DeliverySource", 0);
      expect(result.logDelivery).toBeUndefined();
    });
  });

  describe("S3 options", () => {
    it("uses a prefix in place of CloudFront's default path", () => {
      const { template } = withV2({ destination: { s3: { prefix: "/cdn/" } } });

      template.hasResourceProperties("AWS::Logs::DeliveryDestination", {
        DestinationResourceArn: {
          "Fn::Join": ["", [{ "Fn::GetAtt": [Match.anyValue(), "Arn"] }, "/cdn"]],
        },
      });
      expect(bucketPolicyStatement(template).Resource).toEqual({
        "Fn::Join": ["", [{ "Fn::GetAtt": [expect.any(String), "Arn"] }, "/cdn/*"]],
      });
    });

    it("grants the Hive-compatible default path when Hive paths are enabled", () => {
      const { template } = withV2({ s3EnableHiveCompatiblePath: true });
      expect(bucketPolicyStatement(template).Resource).toEqual({
        "Fn::Join": [
          "",
          [
            { "Fn::GetAtt": [expect.any(String), "Arn"] },
            "/AWSLogs/aws-account-id=",
            { Ref: "AWS::AccountId" },
            "/CloudFront/*",
          ],
        ],
      });
    });

    it("applies a configure callback to the auto-created bucket", () => {
      const { template } = withV2({
        destination: { s3: { configure: (b) => b.bucketName("my-cdn-logs") } },
      });
      template.hasResourceProperties("AWS::S3::Bucket", { BucketName: "my-cdn-logs" });
    });

    it("grants a customer-managed key used by the bucket", () => {
      const stack = newStack({ env: testEnv("us-east-1") });
      const key = new Key(stack, "LogsKey");

      createDistributionBuilder()
        .origin(ORIGIN)
        .accessLogs(
          v2({
            destination: {
              s3: { configure: (b) => b.encryptionKey(ref<{ key: Key }>("logsKey").get("key")) },
            },
          }),
        )
        .build(stack, "TestDistribution", { logsKey: { key } });

      Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
        KeyPolicy: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: "delivery.logs.amazonaws.com" },
              Action: Match.arrayWith(["kms:GenerateDataKey*"]),
            }),
          ]),
        },
      });
    });

    it("delivers to a user-supplied bucket, granted through its policy", () => {
      const { template, result } = buildAndSynth((b, stack) =>
        b.accessLogs(v2({ destination: { s3: { bucket: new Bucket(stack, "Logs") } } })),
      );

      template.resourceCountIs("AWS::S3::Bucket", 1);
      expect(result.accessLogsBucket).toBeUndefined();
      expect(bucketPolicyStatement(template).Action).toBe("s3:PutObject");
    });

    it("resolves a user-supplied bucket through a ref", () => {
      const stack = newStack({ env: testEnv("us-east-1") });
      const logs = new Bucket(stack, "Logs");

      createDistributionBuilder()
        .origin(ORIGIN)
        .accessLogs(
          v2({ destination: { s3: { bucket: ref<{ bucket: Bucket }>("logs").get("bucket") } } }),
        )
        .build(stack, "TestDistribution", { logs: { bucket: logs } });

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::DeliveryDestination", {
        DestinationResourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Logs"), "Arn"] },
      });
    });

    it("delivers to a sibling bucket component in a compose graph", () => {
      const stack = newStack({ env: testEnv("us-east-1") });
      compose(
        {
          logs: createBucketBuilder().serverAccessLogs(false),
          cdn: createDistributionBuilder()
            .origin(ORIGIN)
            .accessLogs({
              v2: {
                configure: (d) =>
                  d.destination({
                    s3: { bucket: ref("logs", (r: BucketBuilderResult) => r.bucket) },
                  }),
              },
            }),
        },
        { logs: [], cdn: ["logs"] },
      ).build(stack, "App");

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::S3::Bucket", 1);
      template.hasResourceProperties("AWS::Logs::DeliveryDestination", {
        DestinationResourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Applogs"), "Arn"] },
      });
      expect(bucketPolicyStatement(template).Action).toBe("s3:PutObject");
    });

    it("rejects a bucket name with dots", () => {
      expect(() =>
        buildAndSynth((b, stack) =>
          b.accessLogs(
            v2({
              destination: {
                s3: { bucket: Bucket.fromBucketName(stack, "Logs", "my.logs.bucket") },
              },
            }),
          ),
        ),
      ).toThrow(/bucket "my.logs.bucket".*no dots/);
    });

    it("rejects 'configure' combined with 'bucket'", () => {
      expect(() =>
        buildAndSynth((b, stack) =>
          b.accessLogs(
            v2({
              destination: { s3: { bucket: new Bucket(stack, "Logs"), configure: (sub) => sub } },
            }),
          ),
        ),
      ).toThrow(/'s3.configure' cannot be combined with 's3.bucket'/);
    });
  });

  describe("delivery options", () => {
    it("renders the delivery options as properties", () => {
      const { template } = withV2({ outputFormat: "parquet", s3EnableHiveCompatiblePath: true });

      template.hasResourceProperties("AWS::Logs::DeliveryDestination", {
        OutputFormat: "parquet",
      });
      template.hasResourceProperties("AWS::Logs::Delivery", {
        S3EnableHiveCompatiblePath: true,
      });
    });

    it("passes through an output format it doesn't list", () => {
      const { template } = withV2({ outputFormat: "some-future-format" });
      template.hasResourceProperties("AWS::Logs::DeliveryDestination", {
        OutputFormat: "some-future-format",
      });
    });

    it("enables cookie logging on the distribution", () => {
      const { template } = buildAndSynth((b) => b.accessLogs({ v2: { includeCookies: true } }));
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Logging: { IncludeCookies: true },
        }),
      });
    });
  });

  describe("log group destination", () => {
    it("delivers to the log group and grants it through a resource policy", () => {
      const { template, result } = buildAndSynth((b, stack) =>
        b.accessLogs(v2({ destination: { logGroup: new LogGroup(stack, "AccessLogs") } })),
      );

      template.resourceCountIs("AWS::S3::Bucket", 0);
      template.hasResourceProperties("AWS::Logs::DeliveryDestination", {
        DestinationResourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("AccessLogs"), "Arn"] },
        OutputFormat: Match.absent(),
      });
      const [[policyId, policy]] = Object.entries(resources(template, "AWS::Logs::ResourcePolicy"));
      const document = JSON.stringify(policy.Properties.PolicyDocument);
      expect(document).toContain("delivery.logs.amazonaws.com");
      expect(document).toContain("logs:PutLogEvents");
      const [delivery] = Object.values(resources(template, "AWS::Logs::Delivery"));
      expect(delivery.DependsOn).toContain(policyId);
      expect(result.accessLogsBucket).toBeUndefined();
    });

    it("rejects the S3-only Hive option", () => {
      expect(() =>
        buildAndSynth((b, stack) =>
          b.accessLogs(
            v2({
              destination: { logGroup: new LogGroup(stack, "AccessLogs") },
              s3EnableHiveCompatiblePath: true,
            }),
          ),
        ),
      ).toThrow(/applies only to an S3 destination/);
    });

    it("warns when the log group is outside us-east-1", () => {
      const { stack } = buildAndSynth((b, s) =>
        b.accessLogs(
          v2({
            destination: {
              logGroup: LogGroup.fromLogGroupArn(
                s,
                "AccessLogs",
                `arn:aws:logs:eu-west-1:${TEST_ACCOUNT}:log-group:cdn`,
              ),
            },
          }),
        ),
      );

      expect(
        Annotations.fromStack(stack).findWarning(
          "*",
          Match.stringLikeRegexp('log group in "eu-west-1"'),
        ),
      ).toHaveLength(1);
    });
  });

  describe("deliveryDestinationArn escape hatch", () => {
    const arn = `arn:aws:logs:us-east-1:${TEST_ACCOUNT}:delivery-destination:firehose`;

    it("delivers to the given destination without creating one", () => {
      const { template, result } = withV2({ destination: { deliveryDestinationArn: arn } });

      template.resourceCountIs("AWS::Logs::DeliveryDestination", 0);
      template.resourceCountIs("AWS::S3::Bucket", 0);
      template.hasResourceProperties("AWS::Logs::Delivery", { DeliveryDestinationArn: arn });
      expect(result.logDelivery?.destination).toBeUndefined();
    });

    it("rejects an outputFormat, which belongs to the destination", () => {
      expect(() =>
        withV2({ destination: { deliveryDestinationArn: arn }, outputFormat: "json" }),
      ).toThrow(/'outputFormat' cannot be combined with 'deliveryDestinationArn'/);
    });
  });

  describe("region", () => {
    it("throws when the stack is in another region", () => {
      expect(() =>
        buildAndSynth((b) => b.accessLogs({ v2: {} }), {
          stackProps: { env: testEnv("eu-west-1") },
        }),
      ).toThrow(/must be set up in us-east-1.*"eu-west-1"/s);
    });

    it("leaves legacy logging available outside us-east-1", () => {
      expect(() =>
        buildAndSynth((b) => b, { stackProps: { env: testEnv("eu-west-1") } }),
      ).not.toThrow();
    });

    describe("env-agnostic stacks", () => {
      beforeEach(() => {
        vi.stubEnv("CDK_DEFAULT_REGION", "");
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("warns when CDK_DEFAULT_REGION is unset", () => {
        const { stack } = buildAndSynth((b) => b.accessLogs({ v2: {} }), { stackProps: {} });
        expect(
          Annotations.fromStack(stack).findWarning(
            "*",
            Match.stringLikeRegexp("env-agnostic and CDK_DEFAULT_REGION"),
          ),
        ).toHaveLength(1);
      });

      it("passes when CDK_DEFAULT_REGION is us-east-1", () => {
        vi.stubEnv("CDK_DEFAULT_REGION", "us-east-1");
        const { stack } = buildAndSynth((b) => b.accessLogs({ v2: {} }), { stackProps: {} });
        expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toHaveLength(0);
      });

      it("throws when CDK_DEFAULT_REGION is another region", () => {
        vi.stubEnv("CDK_DEFAULT_REGION", "eu-west-2");
        expect(() => buildAndSynth((b) => b.accessLogs({ v2: {} }), { stackProps: {} })).toThrow(
          /"eu-west-2"/,
        );
      });
    });
  });

  it("builds in an App with several stacks without name collisions", () => {
    const app = new App();
    const names = ["A", "B"].map((id) => {
      const stack = new Stack(app, id, { env: testEnv("us-east-1") });
      return createDistributionBuilder().origin(ORIGIN).accessLogs({ v2: {} }).build(stack, "Cdn")
        .logDelivery?.source.name;
    });
    expect(names[0]).not.toBe(names[1]);
  });
});

describe("createCloudFrontLogDeliveryBuilder", () => {
  const sourceStack = newStack({ env: testEnv("eu-west-2") }, "SiteStack");
  const imported = (distributionId: string): IDistribution =>
    Distribution.fromDistributionAttributes(sourceStack, distributionId, {
      distributionId,
      domainName: `${distributionId}.cloudfront.net`,
    });

  it("requires a distribution", () => {
    expect(() =>
      createCloudFrontLogDeliveryBuilder().build(newStack({ env: testEnv("us-east-1") }), "Logs"),
    ).toThrow(/requires a distribution/);
  });

  it("delivers a distribution from another stack, resolved through a ref", () => {
    const stack = newStack({ env: testEnv("us-east-1") });
    const result = createCloudFrontLogDeliveryBuilder()
      .distribution(ref<{ distribution: IDistribution }>("cdn").get("distribution"))
      .build(stack, "Logs", { cdn: { distribution: imported("EDFDVBD6EXAMPLE") } });

    expect(JSON.stringify(stack.resolve(result.source.resourceArn))).toContain(
      ":distribution/EDFDVBD6EXAMPLE",
    );
    expect(result.bucket).toBeDefined();
  });

  it("copies its distribution with the builder", () => {
    const first = imported("EFIRST");
    const second = imported("ESECOND");
    assertCopyPreservesState({
      factory: () => createCloudFrontLogDeliveryBuilder(),
      configure: (b) => {
        b.distribution(first);
      },
      mutate: (b) => {
        b.distribution(second);
      },
      build: (b) => {
        const stack = newStack({ env: testEnv("us-east-1") });
        return { stack, result: b.build(stack, "Logs") };
      },
      inspect: ({ stack, result }) => JSON.stringify(stack.resolve(result.source.resourceArn)),
    });
  });
});
