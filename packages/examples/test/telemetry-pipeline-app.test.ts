import { describe, it, expect } from "vitest";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import {
  createTelemetryPipelineApp,
  TELEMETRY_STREAM_NAME,
} from "../src/telemetry-pipeline-app.js";

describe("telemetry-pipeline-app", () => {
  const { stack } = createTelemetryPipelineApp();
  const template = Template.fromStack(stack);
  const keyId = Object.keys(template.findResources("AWS::KMS::Key"))[0];
  const streamId = Object.keys(template.findResources("AWS::Kinesis::Stream"))[0];
  const consumerId = Object.keys(template.findResources("AWS::Kinesis::StreamConsumer"))[0];

  it("creates a one-shard provisioned stream with week-long retention, encrypted with the composed key", () => {
    template.resourceCountIs("AWS::KMS::Key", 1);
    template.resourceCountIs("AWS::Kinesis::Stream", 1);
    template.hasResourceProperties("AWS::Kinesis::Stream", {
      Name: TELEMETRY_STREAM_NAME,
      ShardCount: 1,
      RetentionPeriodHours: 168,
      StreamEncryption: {
        EncryptionType: "KMS",
        KeyId: { "Fn::GetAtt": [keyId, "Arn"] },
      },
    });
  });

  it("keys the latest-readings table by device", () => {
    template.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      KeySchema: [{ AttributeName: "deviceId", KeyType: "HASH" }],
    });
  });

  it("registers an enhanced fan-out consumer for the alerter", () => {
    template.resourceCountIs("AWS::Kinesis::StreamConsumer", 1);
    template.hasResourceProperties("AWS::Kinesis::StreamConsumer", {
      ConsumerName: "anomaly-alerter",
      StreamARN: { "Fn::GetAtt": [streamId, "Arn"] },
    });
  });

  it("attaches the writer to the stream with bounded retries and an onFailure DLQ", () => {
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 2);
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      EventSourceArn: { "Fn::GetAtt": [streamId, "Arn"] },
      StartingPosition: "LATEST",
      BisectBatchOnFunctionError: true,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      MaximumRetryAttempts: 3,
      MaximumRecordAgeInSeconds: 3600,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  it("attaches the alerter through the EFO consumer", () => {
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      EventSourceArn: { "Fn::GetAtt": [consumerId, "ConsumerARN"] },
      StartingPosition: "LATEST",
    });
  });

  it("grants the writer put-only access to the table", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "dynamodb:PutItem", Effect: "Allow" }),
        ]),
      }),
    });
  });

  it("grants the stream key's decrypt to both consumers through their event sources", () => {
    const decryptors = Object.values(
      template.findResources("AWS::IAM::Policy", {
        Properties: {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: "kms:Decrypt",
                Resource: { "Fn::GetAtt": [keyId, "Arn"] },
              }),
            ]),
          },
        },
      }),
    );
    expect(decryptors).toHaveLength(2);
  });

  it("creates the stream's and the EFO consumer's recommended alarms", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Kinesis",
      MetricName: "GetRecords.IteratorAgeMilliseconds",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Kinesis",
      MetricName: "SubscribeToShardEvent.MillisBehindLatest",
    });
  });

  it("does not warn about a missing stream dead-letter destination", () => {
    expect(
      Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp("stream-dlq-missing")),
    ).toEqual([]);
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
