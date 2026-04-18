import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  EmailSubscription,
  LambdaSubscription,
  SqsSubscription,
} from "aws-cdk-lib/aws-sns-subscriptions";
import { ref } from "@composurecdk/core";
import { createTopicBuilder } from "../src/topic-builder.js";

function synthTemplate(
  configureFn?: (builder: ReturnType<typeof createTopicBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createTopicBuilder();
  configureFn?.(builder);
  builder.build(stack, "TestTopic");
  return Template.fromStack(stack);
}

describe("TopicBuilder", () => {
  describe("build", () => {
    it("returns a TopicBuilderResult with a topic property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createTopicBuilder();

      const result = builder.build(stack, "TestTopic");

      expect(result).toBeDefined();
      expect(result.topic).toBeDefined();
    });

    it("creates exactly one SNS topic", () => {
      const template = synthTemplate();

      template.resourceCountIs("AWS::SNS::Topic", 1);
    });
  });

  describe("synthesised output", () => {
    it("creates a topic with the specified display name", () => {
      const template = synthTemplate((b) => b.displayName("My Topic"));

      template.hasResourceProperties("AWS::SNS::Topic", {
        DisplayName: "My Topic",
      });
    });

    it("creates a topic with the specified topic name", () => {
      const template = synthTemplate((b) => b.topicName("my-topic"));

      template.hasResourceProperties("AWS::SNS::Topic", {
        TopicName: "my-topic",
      });
    });

    it("creates a FIFO topic when configured", () => {
      const template = synthTemplate((b) => b.fifo(true).topicName("my-topic.fifo"));

      template.hasResourceProperties("AWS::SNS::Topic", {
        FifoTopic: true,
        TopicName: "my-topic.fifo",
      });
    });

    it("creates a topic with content-based deduplication", () => {
      const template = synthTemplate((b) =>
        b.fifo(true).contentBasedDeduplication(true).topicName("my-topic.fifo"),
      );

      template.hasResourceProperties("AWS::SNS::Topic", {
        FifoTopic: true,
        ContentBasedDeduplication: true,
      });
    });
  });

  describe("addSubscription", () => {
    it("returns {} for subscriptions when none are added", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTopicBuilder().build(stack, "TestTopic");

      expect(result.subscriptions).toEqual({});
    });

    it("creates a Subscription resource for an EmailSubscription", () => {
      const template = synthTemplate((b) =>
        b.addSubscription("ops", new EmailSubscription("ops@example.com")),
      );

      template.resourceCountIs("AWS::SNS::Subscription", 1);
      template.hasResourceProperties("AWS::SNS::Subscription", {
        Protocol: "email",
        Endpoint: "ops@example.com",
      });
    });

    it("wires lambda invoke permission for a LambdaSubscription", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const fn = new LambdaFunction(stack, "Handler", {
        runtime: Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: Code.fromInline("exports.handler = async () => {};"),
      });

      createTopicBuilder()
        .addSubscription("handler", new LambdaSubscription(fn))
        .build(stack, "TestTopic");

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::SNS::Subscription", 1);
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Action: "lambda:InvokeFunction",
        Principal: "sns.amazonaws.com",
      });
    });

    it("wires the SQS queue policy for an SqsSubscription", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const queue = new Queue(stack, "Q");

      createTopicBuilder()
        .addSubscription("queue", new SqsSubscription(queue))
        .build(stack, "TestTopic");

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::SNS::Subscription", 1);
      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Action: "sqs:SendMessage",
              Principal: { Service: "sns.amazonaws.com" },
            }),
          ]),
        }),
      });
    });

    it("exposes each subscription in the result keyed by name", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTopicBuilder()
        .addSubscription("ops", new EmailSubscription("ops@example.com"))
        .addSubscription("oncall", new EmailSubscription("oncall@example.com"))
        .build(stack, "TestTopic");

      expect(Object.keys(result.subscriptions).sort()).toEqual(["oncall", "ops"]);
    });

    it("resolves a Resolvable<ITopicSubscription> from the compose context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const fn = new LambdaFunction(stack, "Handler", {
        runtime: Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: Code.fromInline("exports.handler = async () => {};"),
      });

      createTopicBuilder()
        .addSubscription(
          "handler",
          ref("handler", (r: { function: LambdaFunction }) => new LambdaSubscription(r.function)),
        )
        .build(stack, "TestTopic", { handler: { function: fn } });

      Template.fromStack(stack).resourceCountIs("AWS::SNS::Subscription", 1);
    });
  });

  describe("secure defaults", () => {
    it("enforces SSL by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::SNS::TopicPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: {
                Bool: { "aws:SecureTransport": "false" },
              },
            }),
          ]),
        },
      });
    });

    it("allows the user to disable SSL enforcement", () => {
      const template = synthTemplate((b) => b.enforceSSL(false));

      template.resourceCountIs("AWS::SNS::TopicPolicy", 0);
    });
  });
});
