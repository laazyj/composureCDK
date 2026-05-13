import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { SubscriptionFilter, Topic } from "aws-cdk-lib/aws-sns";
import {
  EmailSubscription,
  LambdaSubscription,
  SqsSubscription,
} from "aws-cdk-lib/aws-sns-subscriptions";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { compose, ref } from "@composurecdk/core";
import { createTopicBuilder } from "../src/topic-builder.js";
import {
  createSubscriptionBuilder,
  type SubscriptionBuilderResult,
} from "../src/subscription-builder.js";
import type { TopicBuilderResult } from "../src/topic-builder.js";

function buildEmail() {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const topic = new Topic(stack, "Topic");
  const result = createSubscriptionBuilder()
    .topic(topic)
    .subscription(new EmailSubscription("ops@example.com"))
    .build(stack, "Sub");
  return { stack, topic, result, template: Template.fromStack(stack) };
}

function makeLambdaHandler(stack: Stack, id = "Handler") {
  return new LambdaFunction(stack, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = async () => {};"),
  });
}

describe("SubscriptionBuilder", () => {
  describe("build", () => {
    it("returns a SubscriptionBuilderResult with the subscription", () => {
      const { result } = buildEmail();

      expect(result).toBeDefined();
      expect(result.subscription).toBeDefined();
    });

    it("creates exactly one SNS subscription", () => {
      const { template } = buildEmail();

      template.resourceCountIs("AWS::SNS::Subscription", 1);
    });

    it("throws a descriptive error when topic is not set", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createSubscriptionBuilder().subscription(
        new EmailSubscription("ops@example.com"),
      );

      expect(() => builder.build(stack, "Sub")).toThrow(
        /SubscriptionBuilder "Sub": topic is required/,
      );
    });

    it("throws a descriptive error when subscription is not set", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const builder = createSubscriptionBuilder().topic(topic);

      expect(() => builder.build(stack, "Sub")).toThrow(
        /SubscriptionBuilder "Sub": subscription is required/,
      );
    });
  });

  describe("synthesised output", () => {
    it("creates an email subscription with the expected protocol and endpoint", () => {
      const { template } = buildEmail();

      template.hasResourceProperties("AWS::SNS::Subscription", {
        Protocol: "email",
        Endpoint: "ops@example.com",
        TopicArn: Match.objectLike({ Ref: Match.stringLikeRegexp("^Topic") }),
      });
    });

    it("emits the Lambda invoke permission for a LambdaSubscription", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const handler = makeLambdaHandler(stack);

      createSubscriptionBuilder()
        .topic(topic)
        .subscription(new LambdaSubscription(handler))
        .build(stack, "Sub");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "lambda" });
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Action: "lambda:InvokeFunction",
        Principal: "sns.amazonaws.com",
      });
    });

    it("emits the SQS queue policy for an SqsSubscription", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const queue = new Queue(stack, "Queue");

      createSubscriptionBuilder()
        .topic(topic)
        .subscription(new SqsSubscription(queue))
        .build(stack, "Sub");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "sqs" });
      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sqs:SendMessage",
              Effect: "Allow",
              Principal: { Service: "sns.amazonaws.com" },
            }),
          ]),
        }),
      });
    });

    it("forwards subscription options (filter policy) configured on the ITopicSubscription", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");

      createSubscriptionBuilder()
        .topic(topic)
        .subscription(
          new EmailSubscription("ops@example.com", {
            filterPolicy: {
              severity: SubscriptionFilter.stringFilter({ allowlist: ["HIGH"] }),
            },
          }),
        )
        .build(stack, "Sub");

      Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
        FilterPolicy: { severity: ["HIGH"] },
      });
    });

    it("forwards a dead-letter queue configured on the ITopicSubscription", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const dlq = new Queue(stack, "Dlq");

      createSubscriptionBuilder()
        .topic(topic)
        .subscription(new EmailSubscription("ops@example.com", { deadLetterQueue: dlq }))
        .build(stack, "Sub");

      Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
        RedrivePolicy: Match.objectLike({
          deadLetterTargetArn: Match.objectLike({
            "Fn::GetAtt": Match.arrayWith([Match.stringLikeRegexp("^Dlq")]),
          }),
        }),
      });
    });
  });

  describe("composition via ref", () => {
    it("resolves a topic ref during build", () => {
      const system = compose(
        {
          topic: createTopicBuilder().topicName("budget-alerts").recommendedAlarms(false),
          email: createSubscriptionBuilder()
            .topic(ref<TopicBuilderResult>("topic").get("topic"))
            .subscription(new EmailSubscription("ops@example.com")),
        },
        { topic: [], email: ["topic"] },
      );

      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = system.build(stack, "System") as {
        topic: TopicBuilderResult;
        email: SubscriptionBuilderResult;
      };

      expect(result.email.subscription).toBeDefined();

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::SNS::Topic", 1);
      template.resourceCountIs("AWS::SNS::Subscription", 1);
      template.hasResourceProperties("AWS::SNS::Subscription", {
        Protocol: "email",
        Endpoint: "ops@example.com",
        TopicArn: Match.objectLike({ Ref: Match.stringLikeRegexp("topic") }),
      });
    });

    it("resolves a subscription ref to a Lambda built by a sibling component", () => {
      const system = compose(
        {
          topic: createTopicBuilder().topicName("alerts").recommendedAlarms(false),
          handler: {
            build: (scope: Stack, id: string) => ({
              function: new LambdaFunction(scope, id, {
                runtime: Runtime.NODEJS_20_X,
                handler: "index.handler",
                code: Code.fromInline("exports.handler = async () => {};"),
                timeout: Duration.seconds(5),
              }),
            }),
          },
          sub: createSubscriptionBuilder()
            .topic(ref<TopicBuilderResult>("topic").get("topic"))
            .subscription(
              ref(
                "handler",
                (r: { function: LambdaFunction }) => new LambdaSubscription(r.function),
              ),
            ),
        },
        { topic: [], handler: [], sub: ["topic", "handler"] },
      );

      const app = new App();
      const stack = new Stack(app, "TestStack");
      system.build(stack, "System");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "lambda" });
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Action: "lambda:InvokeFunction",
        Principal: "sns.amazonaws.com",
      });
    });
  });
});
