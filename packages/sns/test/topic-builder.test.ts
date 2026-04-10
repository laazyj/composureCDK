import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
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
