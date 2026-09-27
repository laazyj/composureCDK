import { describe, expect, it } from "vitest";
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
    // Plus the provider Lambda behind the invocation-logging custom resource.
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 256,
      Description: "Order processor - consumes and processes order messages",
    });
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });

  it("configures the queue with the requested visibility timeout and retention", () => {
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "orders",
      VisibilityTimeout: 180,
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
    // errors, throttles and duration, plus the two event-source contextual
    // alarms (ordersFailedInvocations, ordersDroppedEvents) emitted because
    // an SQS event source is attached.
    template.resourcePropertiesCountIs("AWS::CloudWatch::Alarm", { Namespace: "AWS/Lambda" }, 5);
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

  it("routes the triage model through a tagged application inference profile", () => {
    template.hasResourceProperties("AWS::Bedrock::ApplicationInferenceProfile", {
      InferenceProfileName: "order-triage",
      ModelSource: {
        CopyFrom: {
          "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp("inference-profile/global")])],
        },
      },
      Tags: [{ Key: "CostCentre", Value: "order-processing" }],
    });
  });

  it("grants the consumer the triage model only through its application profile", () => {
    const appProfileArn = {
      "Fn::GetAtt": [Match.stringLikeRegexp("triageProfile"), "InferenceProfileArn"],
    };
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["bedrock:InvokeModel"]),
            Resource: appProfileArn,
          }),
          Match.objectLike({
            Condition: {
              StringEquals: Match.objectLike({ "bedrock:InferenceProfileArn": appProfileArn }),
            },
          }),
        ]),
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          MODEL_ID: {
            "Fn::GetAtt": [Match.stringLikeRegexp("triageProfile"), "InferenceProfileArn"],
          },
        },
      },
    });
  });

  it("requires the consumer to apply a published guardrail", () => {
    template.resourceCountIs("AWS::Bedrock::Guardrail", 1);
    template.resourceCountIs("AWS::Bedrock::GuardrailVersion", 1);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { StringNotEquals: { "bedrock:GuardrailIdentifier": Match.anyValue() } },
          }),
        ]),
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          GUARDRAIL_ARN: Match.anyValue(),
          GUARDRAIL_VERSION: Match.anyValue(),
        }),
      },
    });
  });

  it("creates the model's recommended alarms on the application profile", () => {
    template.resourcePropertiesCountIs(
      "AWS::CloudWatch::Alarm",
      {
        Namespace: "AWS/Bedrock",
        Dimensions: [
          {
            Name: "ModelId",
            Value: {
              "Fn::GetAtt": [Match.stringLikeRegexp("triageProfile"), "InferenceProfileId"],
            },
          },
        ],
      },
      3,
    );
  });

  it("turns on model invocation logging with a delivery-failure alarm", () => {
    // The SDK call is a JSON string joined around tokens, so match on its text.
    expect(JSON.stringify(template.findResources("Custom::AWS"))).toContain(
      "PutModelInvocationLoggingConfiguration",
    );
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Bedrock",
      MetricName: "ModelInvocationLogsCloudWatchDeliveryFailure",
    });
  });

  it("creates the topic, queue, consumer, model and logging recommended alarms", () => {
    // topics 8 + queues 5 + Lambda 5 + model 3 + logging 1
    template.resourceCountIs("AWS::CloudWatch::Alarm", 22);
  });
});
