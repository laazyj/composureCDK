import { describe, expect, it } from "vitest";

import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { assertCapabilitiesCovered, newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { topicGrants } from "../src/grants.js";

function setup() {
  const stack = newStack();
  const topic = new Topic(stack, "Topic");
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, topic, role };
}

const CAPABILITIES = [
  ["publish", "sns:Publish"],
  ["subscribe", "sns:Subscribe"],
] as const;

describe("topicGrants", () => {
  it("covers every capability topicGrants exposes", () => {
    assertCapabilitiesCovered(topicGrants, CAPABILITIES);
  });

  it.each(CAPABILITIES)("%s delegates to the native grant method", (capability, action) => {
    const { stack, topic, role } = setup();

    topicGrants[capability](topic).applyTo(role, {});

    expect(policyJson(stack)).toContain(action);
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable topic from the build context before granting", () => {
    const { stack, topic, role } = setup();

    topicGrants
      .publish(ref<{ topic: Topic }, Topic>("store", (r) => r.topic))
      .applyTo(role, { store: { topic } });

    expect(policyJson(stack)).toContain("sns:Publish");
  });
});
