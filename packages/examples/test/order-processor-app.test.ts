import { describe, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createOrderProcessorApp } from "../src/order-processor-app.js";

describe("order-processor-app", () => {
  const { stack } = createOrderProcessorApp();
  const template = Template.fromStack(stack);

  it("creates the work queue and the subscription dead-letter queue", () => {
    template.resourceCountIs("AWS::SQS::Queue", 2);
  });

  it("creates the alert topic and the order-events intake topic", () => {
    template.resourceCountIs("AWS::SNS::Topic", 2);
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

  it("configures the dead-letter queue with the dlq role's 14-day retention", () => {
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "order-events-dlq",
      MessageRetentionPeriod: 1_209_600,
    });
  });

  it("subscribes the work queue to the intake topic with raw delivery", () => {
    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "sqs",
      // The SQS subscription default — the consumer sees the published
      // payload, not an SNS envelope.
      RawMessageDelivery: true,
    });
  });

  it("attaches the caller-owned dead-letter queue to the subscription", () => {
    template.hasResourceProperties("AWS::SNS::Subscription", {
      RedrivePolicy: {
        deadLetterTargetArn: {
          "Fn::GetAtt": [Match.stringLikeRegexp("orderEventsDlq"), "Arn"],
        },
      },
    });
  });

  it("lets SNS write undeliverable notifications to the dead-letter queue", () => {
    // CDK's Subscription construct adds this statement when a DLQ is
    // attached — the redrive path is dead without it.
    template.hasResourceProperties("AWS::SQS::QueuePolicy", {
      Queues: [{ Ref: Match.stringLikeRegexp("orderEventsDlq") }],
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: "sqs:SendMessage",
            Principal: { Service: "sns.amazonaws.com" },
            Condition: {
              ArnEquals: { "aws:SourceArn": { Ref: Match.stringLikeRegexp("orderEvents") } },
            },
          }),
        ]),
      }),
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

  it("creates the dead-letter depth alarm that surfaces undelivered notifications", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateNumberOfMessagesVisible",
      Namespace: "AWS/SQS",
      Threshold: 0,
      Dimensions: [
        {
          Name: "QueueName",
          Value: { "Fn::GetAtt": [Match.stringLikeRegexp("orderEventsDlq"), "QueueName"] },
        },
      ],
    });
  });

  it("creates the topic, queue, and consumer recommended alarms", () => {
    // Each topic ships 4 recommended (8); the work queue ships 2 recommended
    // + 1 custom, the DLQ 2 from the dlq alarm profile (5); the Lambda
    // consumer ships 2 recommended (errors, throttles) + 2 contextual
    // event-source alarms (4).
    template.resourceCountIs("AWS::CloudWatch::Alarm", 17);
  });
});
