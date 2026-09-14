import { describe, expect, it } from "vitest";
import { Token } from "aws-cdk-lib";
import { newStack } from "../src/stack.js";

describe("newStack", () => {
  it("names the stack TestStack, as all 14 definitions it replaces did", () => {
    expect(newStack().stackName).toBe("TestStack");
  });

  it("is environment-agnostic by default", () => {
    expect(Token.isUnresolved(newStack().region)).toBe(true);
  });

  it("gives each stack its own App, so repeated calls cannot collide on ids", () => {
    expect(newStack().node.root).not.toBe(newStack().node.root);
  });
});
