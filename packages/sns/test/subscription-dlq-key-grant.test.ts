import { describe, it, expect } from "vitest";
import { Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { type IQueue, Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { newStack } from "@composurecdk/cdk-testing";
import { createSubscriptionBuilder } from "../src/subscription-builder.js";
import { createTopicBuilder } from "../src/topic-builder.js";

function cmkDlq(stack: Stack): Queue {
  return new Queue(stack, "Dlq", {
    encryption: QueueEncryption.KMS,
    encryptionMasterKey: new Key(stack, "DlqKey"),
  });
}

/** Both builders bind subscriptions through the same path. */
const BIND_PATHS = {
  createSubscriptionBuilder: (stack: Stack, dlq: IQueue | undefined) => {
    createSubscriptionBuilder()
      .topic(new Topic(stack, "Topic"))
      .subscription(new EmailSubscription("ops@example.com", { deadLetterQueue: dlq }))
      .build(stack, "Sub");
  },
  "TopicBuilder.addSubscription": (stack: Stack, dlq: IQueue | undefined) => {
    createTopicBuilder()
      .addSubscription("ops", new EmailSubscription("ops@example.com", { deadLetterQueue: dlq }))
      .build(stack, "Topic");
  },
};

describe.each(Object.entries(BIND_PATHS))("subscription DLQ key grant via %s", (_, bind) => {
  it("grants sns.amazonaws.com use of a customer-managed DLQ key, scoped to the topic", () => {
    const stack = newStack();
    bind(stack, cmkDlq(stack));

    const template = Template.fromStack(stack);
    const [topicLogicalId] = Object.keys(template.findResources("AWS::SNS::Topic"));
    template.hasResourceProperties("AWS::KMS::Key", {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "sns.amazonaws.com" },
            Action: ["kms:Decrypt", "kms:GenerateDataKey"],
            Condition: { ArnEquals: { "aws:SourceArn": { Ref: topicLogicalId } } },
          }),
        ]),
      },
    });
  });

  it.each([
    ["an SSE-SQS DLQ", (stack: Stack) => new Queue(stack, "Dlq")],
    ["no DLQ", () => undefined],
  ])("adds no key grant and no warning for %s", (_label, makeDlq) => {
    const stack = newStack();
    bind(stack, makeDlq(stack));

    Template.fromStack(stack).resourceCountIs("AWS::KMS::Key", 0);
    expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
  });

  it("warns when the DLQ key is imported and its policy can't be updated", () => {
    const stack = newStack();
    const dlq = Queue.fromQueueAttributes(stack, "Dlq", {
      queueArn: "arn:aws:sqs:us-east-1:123456789012:dlq",
      keyArn: "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab",
    });
    bind(stack, dlq);

    // The ack ID is how callers suppress the warning, so it is public surface.
    Annotations.fromStack(stack).hasWarning(
      "*",
      Match.stringLikeRegexp(
        "encrypted with an imported KMS key.*\\[ack: @composurecdk/sns:subscription-dlq-key-not-granted\\]",
      ),
    );
  });
});
