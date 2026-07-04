import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { ref } from "@composurecdk/core";
import { topicGrants } from "../src/grants.js";

function setup() {
  const app = new App();
  const stack = new Stack(app, "S");
  const topic = new Topic(stack, "Topic");
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, topic, role };
}

const policyJson = (stack: Stack) => JSON.stringify(Template.fromStack(stack).toJSON());

describe("topicGrants", () => {
  it.each([
    ["publish", "sns:Publish"],
    ["subscribe", "sns:Subscribe"],
  ] as const)("%s delegates to the matching native grant method", (capability, action) => {
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
