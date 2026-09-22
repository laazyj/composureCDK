import { describe, expect, it } from "vitest";
import { RemovalPolicy } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import {
  buildFixture,
  newStack,
  tagsPerResource,
  TEST_ACCOUNT,
  testEnv,
} from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createModelInvocationLoggingBuilder } from "../src/model-invocation-logging-builder.js";

const REGION = "eu-west-2";
const buildAndSynth = buildFixture(createModelInvocationLoggingBuilder, "Logging", {
  stackProps: { env: testEnv(REGION) },
});

const SOURCE_CONDITIONS = {
  StringEquals: { "aws:SourceAccount": TEST_ACCOUNT },
  ArnLike: {
    "aws:SourceArn": {
      "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, `:bedrock:${REGION}:${TEST_ACCOUNT}:*`]],
    },
  },
};

/** The `Create` payload the custom resource sends, parsed, with each token as `TOKEN`. */
function loggingConfigOf(template: ReturnType<typeof buildAndSynth>["template"]) {
  const [resource] = Object.values(template.findResources("Custom::AWS")) as {
    Properties: { Create: unknown };
  }[];
  const create = resource.Properties.Create as { "Fn::Join": [string, unknown[]] };
  const json = create["Fn::Join"][1]
    .map((part) => (typeof part === "string" ? part : "TOKEN"))
    .join("");
  return JSON.parse(json) as {
    service: string;
    action: string;
    parameters: { loggingConfig: Record<string, unknown> };
  };
}

describe("createModelInvocationLoggingBuilder", () => {
  it("creates a log group with the logs package's defaults", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 731 });
  });

  it("customises the log group", () => {
    const { template } = buildAndSynth((b) =>
      b.logGroup({ configure: (lg) => lg.removalPolicy(RemovalPolicy.DESTROY) }),
    );

    template.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Delete" });
  });

  it("creates a role Bedrock assumes for this account and Region only", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: { Service: "bedrock.amazonaws.com" },
            Condition: SOURCE_CONDITIONS,
          },
        ],
      },
    });
  });

  it("lets the role write only to Bedrock's log stream", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::IAM::Role", {
      Policies: [
        {
          PolicyName: "ModelInvocationLogsWriter",
          PolicyDocument: {
            Statement: [
              Match.objectLike({
                Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                Resource: {
                  "Fn::Join": ["", Match.arrayWith([":log-stream:aws/bedrock/modelinvocations"])],
                },
              }),
            ],
          },
        },
      ],
    });
  });

  it("puts the logging configuration with every modality on by default", () => {
    const { template } = buildAndSynth();
    const call = loggingConfigOf(template);

    expect(call).toMatchObject({
      service: "Bedrock",
      action: "PutModelInvocationLoggingConfiguration",
    });
    expect(call.parameters.loggingConfig).toMatchObject({
      textDataDeliveryEnabled: true,
      imageDataDeliveryEnabled: true,
      embeddingDataDeliveryEnabled: true,
      videoDataDeliveryEnabled: true,
    });
    expect(call.parameters.loggingConfig.cloudWatchConfig).not.toHaveProperty(
      "largeDataDeliveryS3Config",
    );
  });

  it("honours modality overrides", () => {
    const { template } = buildAndSynth((b) => b.videoDataDeliveryEnabled(false));

    expect(loggingConfigOf(template).parameters.loggingConfig).toMatchObject({
      textDataDeliveryEnabled: true,
      videoDataDeliveryEnabled: false,
    });
  });

  it("deletes the configuration on stack deletion", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("Custom::AWS", {
      Delete: Match.stringLikeRegexp("DeleteModelInvocationLoggingConfiguration"),
    });
  });

  it("scopes the custom resource's permissions", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: [
              "bedrock:PutModelInvocationLoggingConfiguration",
              "bedrock:DeleteModelInvocationLoggingConfiguration",
            ],
            Resource: "*",
          }),
          Match.objectLike({
            Action: "iam:PassRole",
            Resource: { "Fn::GetAtt": [Match.stringLikeRegexp("LoggingRole"), "Arn"] },
          }),
        ]),
      },
    });
  });

  it("orders the configuration after the role", () => {
    const { template } = buildAndSynth();

    template.hasResource("Custom::AWS", {
      DependsOn: Match.arrayWith([Match.stringLikeRegexp("LoggingRole")]),
    });
  });

  describe("large-data bucket", () => {
    it("delivers large bodies to the bucket and lets Bedrock write there", () => {
      const { template } = buildAndSynth((b, stack) =>
        b.largeDataBucket(new Bucket(stack, "Audit")).largeDataKeyPrefix("bedrock"),
      );

      expect(loggingConfigOf(template).parameters.loggingConfig.cloudWatchConfig).toMatchObject({
        largeDataDeliveryS3Config: { keyPrefix: "bedrock" },
      });
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "s3:PutObject",
              Principal: { Service: "bedrock.amazonaws.com" },
              Condition: SOURCE_CONDITIONS,
              Resource: {
                "Fn::Join": [
                  "",
                  Match.arrayWith([
                    `/bedrock/AWSLogs/${TEST_ACCOUNT}/BedrockModelInvocationLogs/*`,
                  ]),
                ],
              },
            }),
          ]),
        },
      });
      template.hasResource("Custom::AWS", {
        DependsOn: Match.arrayWith([Match.stringLikeRegexp("AuditPolicy")]),
      });
    });

    it("writes to the bucket root without a prefix", () => {
      const { template } = buildAndSynth((b, stack) =>
        b.largeDataBucket(new Bucket(stack, "Audit")),
      );

      expect(
        loggingConfigOf(template).parameters.loggingConfig.cloudWatchConfig,
      ).not.toHaveProperty("largeDataDeliveryS3Config.keyPrefix");
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Resource: {
                "Fn::Join": [
                  "",
                  Match.arrayWith([`/AWSLogs/${TEST_ACCOUNT}/BedrockModelInvocationLogs/*`]),
                ],
              },
            }),
          ]),
        },
      });
    });

    it("lets Bedrock encrypt with the bucket's customer managed key", () => {
      const { template } = buildAndSynth((b, stack) =>
        b.largeDataBucket(
          new Bucket(stack, "Audit", {
            encryption: BucketEncryption.KMS,
            encryptionKey: new Key(stack, "Key"),
          }),
        ),
      );

      template.hasResourceProperties("AWS::KMS::Key", {
        KeyPolicy: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "kms:GenerateDataKey",
              Principal: { Service: "bedrock.amazonaws.com" },
              Condition: SOURCE_CONDITIONS,
            }),
          ]),
        },
      });
    });

    it("resolves the bucket from the build context", () => {
      const stack = newStack({ env: testEnv(REGION) });
      const bucket = new Bucket(stack, "Audit");

      createModelInvocationLoggingBuilder()
        .largeDataBucket(ref<{ bucket: Bucket }, Bucket>("audit", (r) => r.bucket))
        .build(stack, "Logging", { audit: { bucket } });

      Template.fromStack(stack).resourceCountIs("AWS::S3::BucketPolicy", 1);
    });
  });

  describe("alarms", () => {
    it("alarms on log group delivery failures by default", () => {
      const { result, template } = buildAndSynth();

      expect(Object.keys(result.alarms)).toEqual(["cloudWatchDeliveryFailure"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/Bedrock",
        MetricName: "ModelInvocationLogsCloudWatchDeliveryFailure",
        Statistic: "Sum",
        Threshold: 0,
        EvaluationPeriods: 1,
        TreatMissingData: "notBreaching",
      });
    });

    it("adds a large-data delivery alarm when a bucket is configured", () => {
      const { result } = buildAndSynth((b, stack) => b.largeDataBucket(new Bucket(stack, "Audit")));

      expect(Object.keys(result.alarms)).toEqual([
        "cloudWatchDeliveryFailure",
        "largeDataS3DeliveryFailure",
      ]);
    });

    it("tunes and disables alarms", () => {
      const { result, template } = buildAndSynth((b, stack) =>
        b.largeDataBucket(new Bucket(stack, "Audit")).recommendedAlarms({
          cloudWatchDeliveryFailure: { threshold: 5 },
          largeDataS3DeliveryFailure: false,
        }),
      );

      expect(Object.keys(result.alarms)).toEqual(["cloudWatchDeliveryFailure"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", { Threshold: 5 });
    });

    it.each([false, { enabled: false }] as const)("disables every alarm with %j", (config) => {
      const { result } = buildAndSynth((b) => b.recommendedAlarms(config));

      expect(result.alarms).toEqual({});
    });
  });

  it("tags the log group, role and alarms", () => {
    const { template } = buildAndSynth((b) => b.tag("Owner", "ml"));

    for (const type of ["AWS::Logs::LogGroup", "AWS::IAM::Role", "AWS::CloudWatch::Alarm"]) {
      expect(tagsPerResource(template, type)).toContainEqual([{ Key: "Owner", Value: "ml" }]);
    }
  });
});
