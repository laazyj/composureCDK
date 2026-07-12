import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import {
  RECEIVING_REGION_WARNING,
  SES_RECEIVING_REGIONS,
  warnIfNotReceivingRegion,
} from "../src/region-support.js";

function stackIn(region?: string): Stack {
  return new Stack(
    new App(),
    "TestStack",
    region ? { env: { account: "111111111111", region } } : {},
  );
}

describe("warnIfNotReceivingRegion", () => {
  it("warns in a region without SES receiving support", () => {
    const stack = stackIn("af-south-1");
    warnIfNotReceivingRegion(stack);
    Annotations.fromStack(stack).hasWarning(
      "*",
      Match.stringLikeRegexp("not available in af-south-1"),
    );
  });

  it("does not warn in a supported region", () => {
    const stack = stackIn("us-east-1");
    warnIfNotReceivingRegion(stack);
    Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
  });

  it("does not warn for an environment-agnostic stack", () => {
    const stack = stackIn();
    warnIfNotReceivingRegion(stack);
    Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
  });

  it("exposes a stable warning id and the region set", () => {
    expect(RECEIVING_REGION_WARNING).toContain("receiving-region");
    expect(SES_RECEIVING_REGIONS.has("us-east-1")).toBe(true);
    expect(SES_RECEIVING_REGIONS.has("af-south-1")).toBe(false);
  });
});
