import { describe, it, expect } from "vitest";
import { App, CfnParameter, Stack } from "aws-cdk-lib";
import { constraints } from "../src/index.js";

const { streamConsumerName: validateStreamConsumerName } = constraints.validate;

describe("constraints.validate.streamConsumerName", () => {
  it("accepts letters, digits and _.-", () => {
    expect(() => {
      validateStreamConsumerName("Anomaly_Alerter-v1.2");
    }).not.toThrow();
  });

  it("accepts a 128-character name", () => {
    expect(() => {
      validateStreamConsumerName("a".repeat(128));
    }).not.toThrow();
  });

  it.each(["anomaly alerter", "alerter/prod", "alertér"])("rejects %j", (name) => {
    expect(() => {
      validateStreamConsumerName(name);
    }).toThrow(/Kinesis StreamConsumer ConsumerName .* is invalid/);
  });

  it("rejects an empty name", () => {
    expect(() => {
      validateStreamConsumerName("");
    }).toThrow();
  });

  it("rejects a name longer than 128 characters", () => {
    expect(() => {
      validateStreamConsumerName("a".repeat(129));
    }).toThrow(/exceeds the 128-character limit/);
  });

  it("skips validation for an unresolved token", () => {
    const stack = new Stack(new App(), "TestStack");
    const param = new CfnParameter(stack, "Name", { type: "String", default: "x" });

    expect(() => {
      validateStreamConsumerName(param.valueAsString);
    }).not.toThrow();
  });
});
