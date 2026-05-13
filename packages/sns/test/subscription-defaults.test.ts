import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { SubscriptionProtocol, Topic, type TopicSubscriptionConfig } from "aws-cdk-lib/aws-sns";
import {
  EmailSubscription,
  LambdaSubscription,
  SqsSubscription,
  UrlSubscription,
} from "aws-cdk-lib/aws-sns-subscriptions";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { SUBSCRIPTION_DEFAULTS, applySubscriptionDefaults } from "../src/subscription-defaults.js";
import { createSubscriptionBuilder } from "../src/subscription-builder.js";
import { createTopicBuilder } from "../src/topic-builder.js";

function makeHandler(stack: Stack, id = "Handler") {
  return new LambdaFunction(stack, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = async () => {};"),
  });
}

function newStack() {
  const app = new App();
  return new Stack(app, "TestStack");
}

describe("SUBSCRIPTION_DEFAULTS", () => {
  it("opts SQS and Firehose into raw message delivery", () => {
    expect(SUBSCRIPTION_DEFAULTS[SubscriptionProtocol.SQS]).toEqual({ rawMessageDelivery: true });
    expect(SUBSCRIPTION_DEFAULTS[SubscriptionProtocol.FIREHOSE]).toEqual({
      rawMessageDelivery: true,
    });
  });

  it.each([
    SubscriptionProtocol.LAMBDA,
    SubscriptionProtocol.EMAIL,
    SubscriptionProtocol.EMAIL_JSON,
    SubscriptionProtocol.SMS,
    SubscriptionProtocol.HTTPS,
    SubscriptionProtocol.HTTP,
    SubscriptionProtocol.APPLICATION,
  ])("declares no defaults for %s", (protocol) => {
    expect(SUBSCRIPTION_DEFAULTS[protocol]).toBeUndefined();
  });
});

describe("applySubscriptionDefaults", () => {
  function baseConfig(
    protocol: SubscriptionProtocol,
    overrides: Partial<TopicSubscriptionConfig> = {},
  ): TopicSubscriptionConfig {
    return {
      subscriberId: "Sub",
      protocol,
      endpoint: "endpoint-value",
      ...overrides,
    };
  }

  it("fills in rawMessageDelivery when the protocol has a default and the config did not set it", () => {
    const stack = newStack();
    const merged = applySubscriptionDefaults(stack, "Sub", baseConfig(SubscriptionProtocol.SQS));

    expect(merged.rawMessageDelivery).toBe(true);
  });

  it("preserves an explicit rawMessageDelivery=false on a protocol with a default", () => {
    const stack = newStack();
    const merged = applySubscriptionDefaults(
      stack,
      "Sub",
      baseConfig(SubscriptionProtocol.SQS, { rawMessageDelivery: false }),
    );

    expect(merged.rawMessageDelivery).toBe(false);
  });

  it("treats an explicit undefined as 'not set' so the default still applies", () => {
    // ITopicSubscription bind() results often propagate undefined from their
    // props (e.g. SqsSubscription always sets rawMessageDelivery: this.props.rawMessageDelivery).
    // A naive { ...defaults, ...config } spread would clobber the default with undefined;
    // this asserts the helper avoids that.
    const stack = newStack();
    const merged = applySubscriptionDefaults(
      stack,
      "Sub",
      baseConfig(SubscriptionProtocol.SQS, { rawMessageDelivery: undefined }),
    );

    expect(merged.rawMessageDelivery).toBe(true);
  });

  it("leaves protocols without defaults unchanged", () => {
    const stack = newStack();
    const merged = applySubscriptionDefaults(stack, "Sub", baseConfig(SubscriptionProtocol.HTTPS));

    expect(merged.rawMessageDelivery).toBeUndefined();
  });

  it("emits a synth-time warning for HTTP subscriptions, ack-tagged with a stable ID", () => {
    const stack = newStack();
    applySubscriptionDefaults(stack, "Sub", baseConfig(SubscriptionProtocol.HTTP));

    // The ack tag is what callers use to suppress the warning via
    // `Annotations.of(scope).acknowledgeWarning(...)`, so the ID is part of
    // the public surface — guard against accidental rename.
    Annotations.fromStack(stack).hasWarning(
      "/TestStack",
      Match.stringLikeRegexp(
        "delivering over plain HTTP.*\\[ack: @composurecdk/sns:http-subscription-insecure\\]",
      ),
    );
  });

  it("does not warn for HTTPS subscriptions", () => {
    const stack = newStack();
    applySubscriptionDefaults(stack, "Sub", baseConfig(SubscriptionProtocol.HTTPS));

    expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
  });
});

describe("integration with createSubscriptionBuilder", () => {
  it("applies rawMessageDelivery=true for an SqsSubscription bound through the builder", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");
    const queue = new Queue(stack, "Queue");

    createSubscriptionBuilder()
      .topic(topic)
      .subscription(new SqsSubscription(queue))
      .build(stack, "Sub");

    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "sqs",
      RawMessageDelivery: true,
    });
  });

  it("lets a caller override the default to rawMessageDelivery=false on the ITopicSubscription", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");
    const queue = new Queue(stack, "Queue");

    createSubscriptionBuilder()
      .topic(topic)
      .subscription(new SqsSubscription(queue, { rawMessageDelivery: false }))
      .build(stack, "Sub");

    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "sqs",
      RawMessageDelivery: false,
    });
  });

  it("does not enable raw delivery for Lambda subscriptions", () => {
    // SNS does not support raw delivery to Lambda — CDK rejects it at synth.
    // The defaults map omits LAMBDA so this combination synthesises cleanly.
    const stack = newStack();
    const topic = new Topic(stack, "Topic");
    const handler = makeHandler(stack);

    createSubscriptionBuilder()
      .topic(topic)
      .subscription(new LambdaSubscription(handler))
      .build(stack, "Sub");

    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "lambda",
      RawMessageDelivery: Match.absent(),
    });
  });

  it("does not enable raw delivery for email subscriptions", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");

    createSubscriptionBuilder()
      .topic(topic)
      .subscription(new EmailSubscription("ops@example.com"))
      .build(stack, "Sub");

    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      RawMessageDelivery: Match.absent(),
    });
  });

  it("warns when binding an HTTP UrlSubscription", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");

    createSubscriptionBuilder()
      .topic(topic)
      .subscription(new UrlSubscription("http://example.com/hook"))
      .build(stack, "Sub");

    Annotations.fromStack(stack).hasWarning(
      "/TestStack",
      Match.stringLikeRegexp("delivering over plain HTTP"),
    );
  });

  it("does not warn for an HTTPS UrlSubscription", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");

    createSubscriptionBuilder()
      .topic(topic)
      .subscription(new UrlSubscription("https://example.com/hook"))
      .build(stack, "Sub");

    expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
  });
});

describe("integration with TopicBuilder.addSubscription", () => {
  it("applies rawMessageDelivery=true for an SqsSubscription on a topic builder", () => {
    const stack = newStack();
    const queue = new Queue(stack, "Queue");

    createTopicBuilder()
      .topicName("alerts")
      .recommendedAlarms(false)
      .addSubscription("queue", new SqsSubscription(queue))
      .build(stack, "Alerts");

    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "sqs",
      RawMessageDelivery: true,
    });
  });

  it("warns on HTTP subscriptions added via the topic builder", () => {
    const stack = newStack();

    createTopicBuilder()
      .topicName("alerts")
      .recommendedAlarms(false)
      .addSubscription("hook", new UrlSubscription("http://example.com/hook"))
      .build(stack, "Alerts");

    Annotations.fromStack(stack).hasWarning(
      "/TestStack",
      Match.stringLikeRegexp("delivering over plain HTTP"),
    );
  });
});
