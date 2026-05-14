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

  it("creates one Lambda consumer wired to the queue via an event source", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 256,
      Description: "Order processor — consumes and processes order messages",
    });
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
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

  it("creates the recommended Lambda alarms for the consumer", () => {
    // errors + throttles, plus the two event-source contextual alarms
    // (ordersFailedInvocations, ordersDroppedEvents) emitted because an SQS
    // event source is attached. The duration alarm is timeout-relative and
    // the consumer leaves timeout at the CDK default, so it is not emitted.
    template.resourcePropertiesCountIs("AWS::CloudWatch::Alarm", { Namespace: "AWS/Lambda" }, 4);
  });

  it("creates the topic, queue, and consumer recommended alarms", () => {
    // Topic ships 4 recommended; queue ships 2 recommended + 1 custom; the
    // Lambda consumer ships 2 recommended (errors, throttles) + 2 contextual
    // event-source alarms.
    template.resourceCountIs("AWS::CloudWatch::Alarm", 11);
  });
});
