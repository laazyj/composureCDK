import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps a grant on {@link ITable} as a capability helper. */
const capability =
  (apply: (table: ITable, grantee: IGrantable) => void) =>
  (table: Resolvable<ITable>): Grant<IGrantable> =>
    grantVia(table, apply);

/**
 * The key actions `grantWriteData` grants on a table's customer-managed key:
 * aws-cdk-lib's `KEY_READ_ACTIONS` and `KEY_WRITE_ACTIONS` from its `perms.ts`,
 * combined. `ITable.grant` grants none, so a capability built on it adds these
 * itself to stand alone as `write` does.
 */
const KEY_WRITE_ACTIONS = [
  "kms:Decrypt",
  "kms:DescribeKey",
  "kms:Encrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
];

/**
 * Consumer-side grant helpers for a DynamoDB table. Pass one to a grantee
 * builder's `grant(...)` — e.g.
 * `role.grant(tableGrants.readWrite(ref("table", (r) => r.table)))`.
 *
 * `ITable` is implemented by both `Table` and `TableV2`, so these helpers serve
 * either builder's result. Each delegates to the table's native `grant*Data`
 * method, or to `grant` for an action set CDK has no method for. See ADR-0013.
 *
 * Every capability also covers the table's customer-managed key, when it has
 * one, in the grantee's identity policy. On a `TableV2` with replicas that is
 * the primary Region's key only: a replica's key is not granted.
 */
export const tableGrants = {
  /** Read access (`dynamodb:GetItem`, `Query`, `Scan`, …). */
  read: capability((table, grantee) => {
    table.grantReadData(grantee);
  }),
  /** Write access (`dynamodb:PutItem`, `UpdateItem`, `DeleteItem`, …). */
  write: capability((table, grantee) => {
    table.grantWriteData(grantee);
  }),
  /**
   * Put items, and nothing else (`dynamodb:PutItem`) — for a write-once store
   * whose writer must not update or delete. `BatchWriteItem` is left out
   * because it can delete.
   */
  put: capability((table, grantee) => {
    table.grant(grantee, "dynamodb:PutItem");
    table.encryptionKey?.grant(grantee, ...KEY_WRITE_ACTIONS);
  }),
  /** Combined read and write access. */
  readWrite: capability((table, grantee) => {
    table.grantReadWriteData(grantee);
  }),
  /** Full access to the table and its indexes (`dynamodb:*`). */
  fullAccess: capability((table, grantee) => {
    table.grantFullAccess(grantee);
  }),
};
