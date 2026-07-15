import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { EventBus, type IEventBus } from "aws-cdk-lib/aws-events";
import { ConfigurationSetTlsPolicy, EmailSendingEvent } from "aws-cdk-lib/aws-ses";
import { Topic } from "aws-cdk-lib/aws-sns";
import { ref } from "@composurecdk/core";
import { createConfigurationSetBuilder } from "../src/configuration-set-builder.js";
import { eventBusDestination, snsDestination } from "../src/event-destinations/index.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack", {
    env: { account: "111111111111", region: "us-east-1" },
  });
}

describe("ConfigurationSetBuilder", () => {
  it("requires TLS and enables reputation metrics by default", () => {
    const stack = newStack();
    createConfigurationSetBuilder().build(stack, "MailConfig");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::ConfigurationSet", {
      DeliveryOptions: { TlsPolicy: "REQUIRE" },
      ReputationOptions: { ReputationMetricsEnabled: true },
    });
  });

  it("lets the caller override the TLS policy", () => {
    const stack = newStack();
    createConfigurationSetBuilder()
      .tlsPolicy(ConfigurationSetTlsPolicy.OPTIONAL)
      .build(stack, "MailConfig");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::ConfigurationSet", {
      DeliveryOptions: { TlsPolicy: "OPTIONAL" },
    });
  });

  it("passes through a configuration set name", () => {
    const stack = newStack();
    createConfigurationSetBuilder()
      .configurationSetName("transactional")
      .build(stack, "MailConfig");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::ConfigurationSet", {
      Name: "transactional",
    });
  });

  it("wires an SNS event destination filtered to bounce/complaint events", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Feedback");
    const { eventDestinations } = createConfigurationSetBuilder()
      .addEventDestination("feedback", {
        destination: snsDestination(topic),
        events: [EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT],
      })
      .build(stack, "MailConfig");

    expect(eventDestinations.feedback).toBeDefined();
    Template.fromStack(stack).hasResourceProperties("AWS::SES::ConfigurationSetEventDestination", {
      EventDestination: Match.objectLike({
        Enabled: true,
        MatchingEventTypes: ["bounce", "complaint"],
        SnsDestination: Match.anyValue(),
      }),
    });
  });

  it("resolves a Resolvable destination from the build context", () => {
    const stack = newStack();
    // SES event destinations can only target the account's default event bus.
    const bus = EventBus.fromEventBusName(stack, "DefaultBus", "default");
    createConfigurationSetBuilder()
      .addEventDestination("bus", {
        destination: eventBusDestination(
          ref<{ bus: IEventBus }, IEventBus>("busComp", (r) => r.bus),
        ),
      })
      .build(stack, "MailConfig", { busComp: { bus } });

    Template.fromStack(stack).hasResourceProperties("AWS::SES::ConfigurationSetEventDestination", {
      EventDestination: Match.objectLike({ EventBridgeDestination: Match.anyValue() }),
    });
  });

  it("passes through a disabled event destination", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Feedback");
    createConfigurationSetBuilder()
      .addEventDestination("feedback", { destination: snsDestination(topic), enabled: false })
      .build(stack, "MailConfig");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::ConfigurationSetEventDestination", {
      EventDestination: Match.objectLike({ Enabled: false }),
    });
  });

  it("rejects a duplicate event-destination key", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Feedback");
    expect(() =>
      createConfigurationSetBuilder()
        .addEventDestination("feedback", { destination: snsDestination(topic) })
        .addEventDestination("feedback", { destination: snsDestination(topic) })
        .build(stack, "MailConfig"),
    ).toThrow(/duplicate key "feedback"/);
  });

  it("copies accumulated event destinations on .copy()", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Feedback");
    const base = createConfigurationSetBuilder().addEventDestination("feedback", {
      destination: snsDestination(topic),
    });
    base.copy().build(stack, "MailConfig");
    Template.fromStack(stack).resourceCountIs("AWS::SES::ConfigurationSetEventDestination", 1);
  });
});
