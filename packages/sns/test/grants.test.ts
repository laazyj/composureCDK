import { expect, it } from "vitest";

import { Topic } from "aws-cdk-lib/aws-sns";
import { describeGrants, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { topicGrants } from "../src/grants.js";

describeGrants({
  name: "topicGrants",
  grants: topicGrants,
  makeResource: (stack) => new Topic(stack, "Topic"),
  cases: [
    { capability: "publish", grants: ["sns:Publish"] },
    { capability: "subscribe", grants: ["sns:Subscribe"] },
  ],
  extra: (setup) => {
    it("resolves a Resolvable topic from the build context before granting", () => {
      const { stack, resource: topic, role } = setup();

      topicGrants
        .publish(ref<{ topic: Topic }, Topic>("store", (r) => r.topic))
        .applyTo(role, { store: { topic } });

      expect(policyJson(stack)).toContain("sns:Publish");
    });
  },
});
