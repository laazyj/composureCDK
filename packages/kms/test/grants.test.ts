import { expect, it } from "vitest";

import { Key } from "aws-cdk-lib/aws-kms";
import { describeGrants, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { keyGrants } from "../src/grants.js";

describeGrants({
  name: "keyGrants",
  grants: keyGrants,
  makeResource: (stack) => new Key(stack, "Key"),
  cases: [
    { capability: "encrypt", grants: ["kms:Encrypt"] },
    { capability: "decrypt", grants: ["kms:Decrypt"] },
    { capability: "encryptDecrypt", grants: ["kms:GenerateDataKey*"] },
    { capability: "sign", grants: ["kms:Sign"] },
    { capability: "verify", grants: ["kms:Verify"] },
    { capability: "signVerify", grants: ["kms:Sign"] },
    { capability: "generateMac", grants: ["kms:GenerateMac"] },
    { capability: "verifyMac", grants: ["kms:VerifyMac"] },
    // Lifecycle administration only — `denies` pins that it withholds
    // cryptographic use of the key it administers.
    {
      capability: "admin",
      grants: ["kms:ScheduleKeyDeletion"],
      denies: ["kms:Encrypt", "kms:Decrypt"],
    },
  ],
  extra: (setup) => {
    it("resolves a Resolvable key from the build context before granting", () => {
      const { stack, resource: key, role } = setup();

      keyGrants
        .decrypt(ref<{ key: Key }, Key>("tableKey", (r) => r.key))
        .applyTo(role, { tableKey: { key } });

      expect(policyJson(stack)).toContain("kms:Decrypt");
    });
  },
});
