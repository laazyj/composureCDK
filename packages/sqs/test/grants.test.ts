import { expect, it } from "vitest";

import { Queue } from "aws-cdk-lib/aws-sqs";
import { describeGrants, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { queueGrants } from "../src/grants.js";

describeGrants({
  name: "queueGrants",
  grants: queueGrants,
  makeResource: (stack) => new Queue(stack, "Queue"),
  cases: [
    { capability: "consume", grants: ["sqs:ReceiveMessage", "sqs:DeleteMessage"] },
    { capability: "send", grants: ["sqs:SendMessage"] },
    { capability: "purge", grants: ["sqs:PurgeQueue"] },
  ],
  extra: (setup) => {
    it("resolves a Resolvable queue from the build context before granting", () => {
      const { stack, resource: queue, role } = setup();

      queueGrants
        .send(ref<{ queue: Queue }, Queue>("store", (r) => r.queue))
        .applyTo(role, { store: { queue } });

      expect(policyJson(stack)).toContain("sqs:SendMessage");
    });
  },
});
