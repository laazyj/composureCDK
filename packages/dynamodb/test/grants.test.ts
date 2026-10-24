import { describe, expect, it } from "vitest";

import { Template } from "aws-cdk-lib/assertions";
import type { Stack } from "aws-cdk-lib";
import {
  AttributeType,
  type ITable,
  Table,
  TableEncryption,
  TableEncryptionV2,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  assertCapabilitiesCovered,
  newStack,
  policyJson,
  testEnv,
} from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { tableGrants } from "../src/grants.js";

const PARTITION_KEY = { name: "id", type: AttributeType.STRING };

function setup(
  newTable = (stack: Stack): ITable => new Table(stack, "Table", { partitionKey: PARTITION_KEY }),
) {
  // A replica table needs a concrete Region to render.
  const stack = newStack({ env: testEnv("us-east-1") });
  const table = newTable(stack);
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, table, role };
}

interface Statement {
  Action: string | string[];
  Resource: unknown;
}

interface PolicyResource {
  Properties: { PolicyDocument: { Statement: Statement[] } };
}

/** The statements of every identity policy in `stack` that grant a KMS action. */
function kmsStatements(stack: Stack): Statement[] {
  const policies = Template.fromStack(stack).findResources("AWS::IAM::Policy");
  return Object.values(policies)
    .flatMap((p) => (p as PolicyResource).Properties.PolicyDocument.Statement)
    .filter((s) => [s.Action].flat().some((action) => action.startsWith("kms:")));
}

const KEY_READ_ACTIONS = ["kms:Decrypt", "kms:DescribeKey"];
const KEY_WRITE_ACTIONS = [
  ...KEY_READ_ACTIONS,
  "kms:Encrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
];

/** Each capability's table actions, and its key actions on a customer-managed key. */
const CAPABILITIES = [
  ["read", ["dynamodb:GetItem"], KEY_READ_ACTIONS],
  ["write", ["dynamodb:PutItem"], KEY_WRITE_ACTIONS],
  ["put", ["dynamodb:PutItem"], KEY_WRITE_ACTIONS],
  ["readWrite", ["dynamodb:GetItem", "dynamodb:PutItem"], KEY_WRITE_ACTIONS],
  ["fullAccess", ["dynamodb:*"], KEY_WRITE_ACTIONS],
] as const;

const REPLICA_KEY_ARN = "arn:aws:kms:us-west-2:123456789012:key/replica";

const CMK_TABLES: Record<string, (stack: Stack) => ITable> = {
  Table: (stack) =>
    new Table(stack, "Table", {
      partitionKey: PARTITION_KEY,
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: new Key(stack, "Key"),
    }),
  TableV2: (stack) =>
    new TableV2(stack, "Table", {
      partitionKey: PARTITION_KEY,
      encryption: TableEncryptionV2.customerManagedKey(new Key(stack, "Key")),
    }),
  "TableV2 with a replica": (stack) =>
    new TableV2(stack, "Table", {
      partitionKey: PARTITION_KEY,
      encryption: TableEncryptionV2.customerManagedKey(new Key(stack, "Key"), {
        "us-west-2": REPLICA_KEY_ARN,
      }),
      replicas: [{ region: "us-west-2" }],
    }),
};

describe("tableGrants", () => {
  it("covers every capability tableGrants exposes", () => {
    assertCapabilitiesCovered(tableGrants, CAPABILITIES);
  });

  it.each(CAPABILITIES)("%s delegates to the native grant method", (capability, actions) => {
    const { stack, table, role } = setup();

    tableGrants[capability](table).applyTo(role, {});

    const template = Template.fromStack(stack);
    const json = JSON.stringify(template.toJSON());
    for (const action of actions) expect(json).toContain(action);
    template.resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("put grants PutItem alone, not the other write actions", () => {
    const { stack, table, role } = setup();

    tableGrants.put(table).applyTo(role, {});

    const json = policyJson(stack);
    expect(json).toContain("dynamodb:PutItem");
    for (const action of ["UpdateItem", "DeleteItem", "BatchWriteItem"]) {
      expect(json).not.toContain(`dynamodb:${action}`);
    }
  });

  it.each(CAPABILITIES)("%s grants nothing on a key when the table has none", (capability) => {
    const { stack, table, role } = setup();

    tableGrants[capability](table).applyTo(role, {});

    expect(kmsStatements(stack)).toEqual([]);
  });

  // A replica's key is not granted: only the primary Region's key is covered.
  describe.each(Object.entries(CMK_TABLES))(
    "on a %s with a customer-managed key",
    (_, newTable) => {
      it.each(CAPABILITIES)(
        "%s grants the primary key alone",
        (capability, _actions, keyActions) => {
          const { stack, table, role } = setup(newTable);

          tableGrants[capability](table).applyTo(role, {});

          expect(kmsStatements(stack)).toEqual([
            expect.objectContaining({
              Action: [...keyActions],
              Resource: stack.resolve(table.encryptionKey?.keyArn) as unknown,
            }),
          ]);
        },
      );
    },
  );

  it("resolves a Resolvable table from the build context before granting", () => {
    const { stack, table, role } = setup();

    tableGrants
      .readWrite(ref<{ table: Table }, Table>("store", (r) => r.table))
      .applyTo(role, { store: { table } });

    expect(policyJson(stack)).toContain("dynamodb:PutItem");
  });
});
