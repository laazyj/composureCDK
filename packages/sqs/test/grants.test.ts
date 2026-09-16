import { describe, expect, it } from "vitest";

import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { assertCapabilitiesCovered, newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { queueGrants } from "../src/grants.js";

function setup() {
  const stack = newStack();
  const queue = new Queue(stack, "Queue");
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, queue, role };
}

const CAPABILITIES = [
  ["consume", ["sqs:ReceiveMessage", "sqs:DeleteMessage"]],
  ["send", ["sqs:SendMessage"]],
  ["purge", ["sqs:PurgeQueue"]],
] as const;

describe("queueGrants", () => {
  it("covers every capability queueGrants exposes", () => {
    assertCapabilitiesCovered(queueGrants, CAPABILITIES);
  });

  it.each(CAPABILITIES)("%s delegates to the native grant method", (capability, actions) => {
    const { stack, queue, role } = setup();

    queueGrants[capability](queue).applyTo(role, {});

    const json = policyJson(stack);
    for (const action of actions) expect(json).toContain(action);
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable queue from the build context before granting", () => {
    const { stack, queue, role } = setup();

    queueGrants
      .send(ref<{ queue: Queue }, Queue>("store", (r) => r.queue))
      .applyTo(role, { store: { queue } });

    expect(policyJson(stack)).toContain("sqs:SendMessage");
  });
});
