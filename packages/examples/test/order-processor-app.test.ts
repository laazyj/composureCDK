import { describe, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createOrderProcessorApp } from "../src/order-processor-app.js";

describe("order-processor-app", () => {
  const { stack } = createOrderProcessorApp();
  const template = Template.fromStack(stack);

  it("creates one SQS queue", () => {
    template.resourceCountIs("AWS::SQS::Queue", 1);
  });

  it("creates one SNS alert topic", () => {
    template.resourceCountIs("AWS::SNS::Topic", 1);
  });

  it("configures the queue with the requested visibility timeout and retention", () => {
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders",
      VisibilityTimeout: 120,
      MessageRetentionPeriod: 1_209_600,
      ReceiveMessageWaitTimeSeconds: 20,
      SqsManagedSseEnabled: true,
    });
  });

  it("emits an enforceSSL queue policy", () => {
    template.hasResourceProperties("AWS::SQS::QueuePolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Action: "sqs:*",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      }),
    });
  });

  it("creates the tuned approximateAgeOfOldestMessage alarm (60s, 2 of 2)", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateAgeOfOldestMessage",
      Namespace: "AWS/SQS",
      Threshold: 60,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("creates the default approximateNumberOfMessagesNotVisible alarm at 90,000", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateNumberOfMessagesNotVisible",
      Namespace: "AWS/SQS",
      Threshold: 90_000,
    });
  });

  it("creates the custom highEmptyReceiveRate alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "NumberOfEmptyReceives",
      Namespace: "AWS/SQS",
      Threshold: 500,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("routes queue alarms to the alert topic via alarmActionsPolicy", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateAgeOfOldestMessage",
      AlarmActions: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp("alerts") })]),
    });
  });

  it("creates the four SNS topic recommended alarms plus the three queue alarms", () => {
    // Topic ships 4 recommended alarms; queue ships 2 recommended + 1 custom.
    template.resourceCountIs("AWS::CloudWatch::Alarm", 7);
  });
});
