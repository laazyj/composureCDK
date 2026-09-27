import { describe, expect, it } from "vitest";
import { EventBus } from "aws-cdk-lib/aws-events";
import { CloudWatchDimensionSource } from "aws-cdk-lib/aws-ses";
import { Topic } from "aws-cdk-lib/aws-sns";
import { isRef, ref, resolve } from "@composurecdk/core";
import { newStack, testEnv } from "@composurecdk/cdk-testing";
import {
  cloudWatchDestination,
  eventBusDestination,
  snsDestination,
} from "../src/event-destinations/index.js";

describe("event destination helpers", () => {
  it("snsDestination returns a concrete destination for a concrete topic and a ref for a ref", () => {
    const stack = newStack({ env: testEnv("us-east-1") });
    const topic = new Topic(stack, "Topic");
    expect(isRef(snsDestination(topic))).toBe(false);
    const deferred = snsDestination(ref<{ topic: Topic }, Topic>("events", (r) => r.topic));
    expect(isRef(deferred)).toBe(true);
    expect(resolve(deferred, { events: { topic } }).topic).toBe(topic);
  });

  it("eventBusDestination returns a concrete destination for a concrete bus and a ref for a ref", () => {
    const stack = newStack({ env: testEnv("us-east-1") });
    const bus = EventBus.fromEventBusName(stack, "DefaultBus", "default");
    expect(isRef(eventBusDestination(bus))).toBe(false);
    const deferred = eventBusDestination(
      ref<{ bus: typeof bus }, typeof bus>("feed", (r) => r.bus),
    );
    expect(isRef(deferred)).toBe(true);
    expect(resolve(deferred, { feed: { bus } }).bus).toBe(bus);
  });

  it("cloudWatchDestination builds a CloudWatch dimensions destination", () => {
    const destination = cloudWatchDestination([
      { name: "campaign", source: CloudWatchDimensionSource.MESSAGE_TAG, defaultValue: "default" },
    ]);
    expect(destination.dimensions).toHaveLength(1);
  });
});
