import { describe, expect, it } from "vitest";
import { Lazy } from "aws-cdk-lib";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { CustomResponseBodies } from "../src/custom-response.js";
import { createWebAclRuleBuilder } from "../src/rule-builder.js";

const PATH = {
  byteMatchStatement: {
    fieldToMatch: { uriPath: {} },
    positionalConstraint: "STARTS_WITH",
    searchString: "/admin",
    textTransformations: [{ priority: 0, type: "NONE" }],
  },
};

const toRule = (builder: ReturnType<typeof createWebAclRuleBuilder>) => {
  const bodies = new CustomResponseBodies("Test");
  const rule = builder.toRule({
    name: "Rule",
    owner: "Test",
    defaultPriority: 0,
    sampledRequests: false,
    bodies,
  });
  return { rule: rule.property, bodies: bodies.toProperty() };
};

describe("WebAclRuleBuilder", () => {
  it("copies its statement, action, response and labels", () => {
    assertCopyPreservesState({
      factory: createWebAclRuleBuilder,
      configure: (b) => {
        b.statement(PATH).respond(429, { text: "slow down" }).labels("throttled");
      },
      mutate: (b) => {
        b.labels("more");
      },
      build: toRule,
      inspect: (result) => result,
    });
  });

  it("keeps a copy's statement independent", () => {
    const original = createWebAclRuleBuilder();
    const copy = original.copy();
    original.statement(PATH);

    expect(() => toRule(copy)).toThrow(/has no statement/);
  });

  it("accepts a token status code", () => {
    const { rule } = toRule(
      createWebAclRuleBuilder()
        .statement(PATH)
        .respond(Lazy.number({ produce: () => 418 })),
    );

    expect(rule.action).toBeDefined();
  });
});
