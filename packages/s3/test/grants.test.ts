import { expect, it } from "vitest";

import { Bucket } from "aws-cdk-lib/aws-s3";
import { describeGrants, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { bucketGrants } from "../src/grants.js";

describeGrants({
  name: "bucketGrants",
  grants: bucketGrants,
  makeResource: (stack) => new Bucket(stack, "Bucket"),
  cases: [
    { capability: "read", grants: ["s3:GetObject"] },
    { capability: "write", grants: ["s3:PutObject"] },
    { capability: "readWrite", grants: ["s3:GetObject", "s3:PutObject"] },
    { capability: "put", grants: ["s3:PutObject"] },
    { capability: "delete", grants: ["s3:DeleteObject"] },
  ],
  extra: (setup) => {
    it("resolves a Resolvable bucket from the build context before granting", () => {
      const { stack, resource: bucket, role } = setup();

      bucketGrants
        .write(ref<{ bucket: Bucket }, Bucket>("store", (r) => r.bucket))
        .applyTo(role, { store: { bucket } });

      expect(policyJson(stack)).toContain("s3:PutObject");
    });
  },
});
