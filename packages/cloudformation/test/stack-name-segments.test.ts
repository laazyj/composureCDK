import { describe, it, expect } from "vitest";
import { App, NestedStack, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { stackNameSegments } from "../src/stack-name-segments.js";

describe("stackNameSegments", () => {
  it("is the stack's name for a top-level stack", () => {
    const stack = new Stack(new App(), "MyServiceStack");
    expect(stackNameSegments(new Construct(stack, "Child"))).toEqual(["MyServiceStack"]);
  });

  it("honours an explicit stackName", () => {
    const stack = new Stack(new App(), "Id", { stackName: "explicit-name" });
    expect(stackNameSegments(stack)).toEqual(["explicit-name"]);
  });

  it("names a nested stack by the top-level stack's name and each nested id", () => {
    const parent = new Stack(new App(), "ParentStack");
    const nested = new NestedStack(new NestedStack(parent, "DataTier"), "Queues");
    expect(stackNameSegments(new Construct(nested, "Child"))).toEqual([
      "ParentStack",
      "DataTier",
      "Queues",
    ]);
  });
});
