import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { SubscriptionFilter, SubscriptionProtocol, Topic } from "aws-cdk-lib/aws-sns";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { compose, ref } from "@composurecdk/core";
import { createTopicBuilder } from "../src/topic-builder.js";
import {
  createSubscriptionBuilder,
  type SubscriptionBuilderResult,
} from "../src/subscription-builder.js";
import type { TopicBuilderResult } from "../src/topic-builder.js";

function buildWithTopic(
  configureFn?: (
    builder: ReturnType<typeof createSubscriptionBuilder>,
    topic: Topic,
    stack: Stack,
  ) => void,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const topic = new Topic(stack, "Topic");
  const builder = createSubscriptionBuilder().topic(topic);
  configureFn?.(builder, topic, stack);
  const result = builder.build(stack, "Sub");
  return { stack, topic, result, template: Template.fromStack(stack) };
}

describe("SubscriptionBuilder", () => {
  describe("build", () => {
    it("returns a SubscriptionBuilderResult with subscription and alarms", () => {
      const { result } = buildWithTopic((b) =>
        b.protocol(SubscriptionProtocol.EMAIL).endpoint("ops@example.com"),
      );

      expect(result).toBeDefined();
      expect(result.subscription).toBeDefined();
      expect(result.alarms).toEqual({});
    });

    it("creates exactly one SNS subscription", () => {
      const { template } = buildWithTopic((b) =>
        b.protocol(SubscriptionProtocol.EMAIL).endpoint("ops@example.com"),
      );

      template.resourceCountIs("AWS::SNS::Subscription", 1);
    });

    it("throws a descriptive error when topic is not set", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createSubscriptionBuilder()
        .protocol(SubscriptionProtocol.EMAIL)
        .endpoint("ops@example.com");

      expect(() => builder.build(stack, "Sub")).toThrow(
        /SubscriptionBuilder "Sub": topic is required/,
      );
    });
  });

  describe("synthesised output", () => {
    it("creates an email subscription matching the requested YAML shape", () => {
      const { template } = buildWithTopic((b) =>
        b.protocol(SubscriptionProtocol.EMAIL).endpoint("your-email@example.com"),
      );

      template.hasResourceProperties("AWS::SNS::Subscription", {
        Protocol: "email",
        Endpoint: "your-email@example.com",
        TopicArn: Match.objectLike({ Ref: Match.stringLikeRegexp("^Topic") }),
      });
    });

    it.each([
      [SubscriptionProtocol.EMAIL, "email", "ops@example.com"],
      [SubscriptionProtocol.EMAIL_JSON, "email-json", "ops@example.com"],
      [SubscriptionProtocol.HTTPS, "https", "https://example.com/hook"],
      [SubscriptionProtocol.HTTP, "http", "http://example.com/hook"],
      [SubscriptionProtocol.SMS, "sms", "+15551234567"],
    ])("creates a %s subscription", (protocol, expected, endpoint) => {
      const { template } = buildWithTopic((b) => b.protocol(protocol).endpoint(endpoint));

      template.hasResourceProperties("AWS::SNS::Subscription", {
        Protocol: expected,
        Endpoint: endpoint,
      });
    });

    it("applies a filter policy when configured", () => {
      const { template } = buildWithTopic((b) =>
        b
          .protocol(SubscriptionProtocol.EMAIL)
          .endpoint("ops@example.com")
          .filterPolicy({ severity: SubscriptionFilter.stringFilter({ allowlist: ["HIGH"] }) }),
      );

      template.hasResourceProperties("AWS::SNS::Subscription", {
        FilterPolicy: { severity: ["HIGH"] },
      });
    });

    it("enables raw message delivery when explicitly opted in", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const queue = new Queue(stack, "Queue");

      createSubscriptionBuilder()
        .topic(topic)
        .protocol(SubscriptionProtocol.SQS)
        .endpoint(queue.queueArn)
        .rawMessageDelivery(true)
        .build(stack, "Sub");

      Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
        RawMessageDelivery: true,
      });
    });
  });

  describe("secure defaults", () => {
    it("pins raw message delivery to false by default", () => {
      const { template } = buildWithTopic((b) =>
        b.protocol(SubscriptionProtocol.EMAIL).endpoint("ops@example.com"),
      );

      template.hasResourceProperties("AWS::SNS::Subscription", {
        RawMessageDelivery: false,
      });
    });
  });

  describe("dead-letter queue", () => {
    it("attaches a DLQ via RedrivePolicy when provided", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const dlq = new Queue(stack, "Dlq");

      createSubscriptionBuilder()
        .topic(topic)
        .deadLetterQueue(dlq)
        .protocol(SubscriptionProtocol.EMAIL)
        .endpoint("ops@example.com")
        .build(stack, "Sub");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SNS::Subscription", {
        RedrivePolicy: Match.objectLike({
          deadLetterTargetArn: Match.objectLike({
            "Fn::GetAtt": Match.arrayWith([Match.stringLikeRegexp("^Dlq")]),
          }),
        }),
      });
    });
  });

  describe("composition with TopicBuilder via ref", () => {
    it("resolves a topic ref during build", () => {
      const system = compose(
        {
          topic: createTopicBuilder().topicName("budget-alerts").recommendedAlarms(false),
          email: createSubscriptionBuilder()
            .topic(ref<TopicBuilderResult>("topic").get("topic"))
            .protocol(SubscriptionProtocol.EMAIL)
            .endpoint("ops@example.com"),
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
  });
});
