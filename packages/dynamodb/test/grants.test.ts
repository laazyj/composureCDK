import { expect, it } from "vitest";

import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { describeGrants, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { tableGrants } from "../src/grants.js";

describeGrants({
  name: "tableGrants",
  grants: tableGrants,
  makeResource: (stack) =>
    new Table(stack, "Table", { partitionKey: { name: "id", type: AttributeType.STRING } }),
  cases: [
    { capability: "read", grants: ["dynamodb:GetItem"] },
    { capability: "write", grants: ["dynamodb:PutItem"] },
    { capability: "readWrite", grants: ["dynamodb:GetItem", "dynamodb:PutItem"] },
    { capability: "fullAccess", grants: ["dynamodb:*"] },
  ],
  extra: (setup) => {
    it("resolves a Resolvable table from the build context before granting", () => {
      const { stack, resource: table, role } = setup();

      tableGrants
        .readWrite(ref<{ table: Table }, Table>("store", (r) => r.table))
        .applyTo(role, { store: { table } });

      expect(policyJson(stack)).toContain("dynamodb:PutItem");
    });
  },
});
