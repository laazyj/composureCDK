import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { createSubscriptionBuilder } from "../src/subscription-builder.js";

describe("SubscriptionBuilder", () => {
  it("attaches a subscription to the given topic", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const topic = new Topic(stack, "AlertsTopic");

    createSubscriptionBuilder()
      .topic(topic)
      .subscription(new EmailSubscription("ops@example.com"))
      .build(stack, "OpsEmailSub");

    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "ops@example.com",
      TopicArn: Match.anyValue(),
    });
  });

  it("throws if topic was not configured", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const builder = createSubscriptionBuilder().subscription(
      new EmailSubscription("ops@example.com"),
    );

    expect(() => builder.build(stack, "Sub")).toThrow(/topic/);
  });

  it("throws if subscription was not configured", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const topic = new Topic(stack, "AlertsTopic");
    const builder = createSubscriptionBuilder().topic(topic);

    expect(() => builder.build(stack, "Sub")).toThrow(/subscription/);
  });
});
