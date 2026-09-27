import { describe, it, expect } from "vitest";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { createDynamoStreamProcessorApp } from "../src/dynamo-stream-processor-app.js";

describe("dynamo-stream-processor-app", () => {
  const { stack } = createDynamoStreamProcessorApp();
  const template = Template.fromStack(stack);

  it("creates one DynamoDB table with a NEW_AND_OLD_IMAGES stream", () => {
    template.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
    });
  });

  it("creates the dead-letter queue with 14-day retention", () => {
    template.resourceCountIs("AWS::SQS::Queue", 1);
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders-stream-dlq",
      MessageRetentionPeriod: 1_209_600,
    });
  });

  it("creates one Lambda consumer wired to the stream via an event source", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 256,
    });
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });

  it("applies durable stream failure handling: bisect, bounded retries, and an onFailure DLQ", () => {
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "LATEST",
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: 3,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  it("grants the consumer least-privilege stream read access", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["dynamodb:GetRecords", "dynamodb:GetShardIterator"]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });

  it("creates the stream IteratorAge contextual alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Lambda",
      MetricName: "IteratorAge",
    });
  });

  it("does not warn about a missing stream dead-letter destination (the DLQ is wired)", () => {
    expect(
      Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp("stream-dlq-missing")),
    ).toEqual([]);
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
