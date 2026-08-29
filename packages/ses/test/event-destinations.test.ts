import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { EventBus } from "aws-cdk-lib/aws-events";
import { CloudWatchDimensionSource } from "aws-cdk-lib/aws-ses";
import { Topic } from "aws-cdk-lib/aws-sns";
import { isRef, ref } from "@composurecdk/core";
import {
  cloudWatchDestination,
  eventBusDestination,
  snsDestination,
} from "../src/event-destinations/index.js";

function newStack(): Stack {
  return new Stack(new App(), "S", { env: { account: "111111111111", region: "us-east-1" } });
}

describe("event destination helpers", () => {
  it("snsDestination returns a concrete destination for a concrete topic and a ref for a ref", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");
    expect(isRef(snsDestination(topic))).toBe(false);
    expect(isRef(snsDestination(ref("topic")))).toBe(true);
  });

  it("eventBusDestination returns a concrete destination for a concrete bus and a ref for a ref", () => {
    const stack = newStack();
    const bus = EventBus.fromEventBusName(stack, "DefaultBus", "default");
    expect(isRef(eventBusDestination(bus))).toBe(false);
    expect(isRef(eventBusDestination(ref("bus")))).toBe(true);
  });

  it("cloudWatchDestination builds a CloudWatch dimensions destination", () => {
    const destination = cloudWatchDestination([
      { name: "campaign", source: CloudWatchDimensionSource.MESSAGE_TAG, defaultValue: "default" },
    ]);
    expect(destination.dimensions).toHaveLength(1);
  });
});
