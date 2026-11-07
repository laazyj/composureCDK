import { describe, it, expect } from "vitest";
import { App, CfnParameter, Stack } from "aws-cdk-lib";
import { constraints } from "../src/index.js";

const { streamName: validateStreamName } = constraints.validate;

describe("constraints.validate.streamName", () => {
  it("accepts letters, digits and _.-", () => {
    expect(() => {
      validateStreamName("Telemetry_v1.2-prod");
    }).not.toThrow();
  });

  it("accepts a 128-character name", () => {
    expect(() => {
      validateStreamName("a".repeat(128));
    }).not.toThrow();
  });

  it.each(["telemetry stream", "telemetry/prod", "télémétrie"])("rejects %j", (name) => {
    expect(() => {
      validateStreamName(name);
    }).toThrow(/is invalid/);
  });

  it("rejects an empty name", () => {
    expect(() => {
      validateStreamName("");
    }).toThrow();
  });

  it("rejects a name longer than 128 characters", () => {
    expect(() => {
      validateStreamName("a".repeat(129));
    }).toThrow(/exceeds the 128-character limit/);
  });

  it("skips validation for an unresolved token", () => {
    const stack = new Stack(new App(), "TestStack");
    const param = new CfnParameter(stack, "Name", { type: "String", default: "x" });

    expect(() => {
      validateStreamName(param.valueAsString);
    }).not.toThrow();
  });
});
