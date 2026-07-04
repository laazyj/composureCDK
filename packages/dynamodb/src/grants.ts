import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link ITable}'s native grant methods as a capability helper. */
const capability =
  (apply: (table: ITable, grantee: IGrantable) => void) =>
  (table: Resolvable<ITable>): Grant<IGrantable> =>
    grantVia(table, apply);

/**
 * Consumer-side grant helpers for a DynamoDB table. Pass one to a grantee
 * builder's `grant(...)` — e.g.
 * `role.grant(tableGrants.readWrite(ref("table", (r) => r.table)))`.
 *
 * `ITable` is implemented by both `Table` and `TableV2`, so these helpers serve
 * either builder's result. Each delegates to the table's native `grant*Data`
 * method. See ADR-0013.
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
  /** Combined read and write access. */
  readWrite: capability((table, grantee) => {
    table.grantReadWriteData(grantee);
  }),
  /** Full access to the table and its indexes (`dynamodb:*`). */
  fullAccess: capability((table, grantee) => {
    table.grantFullAccess(grantee);
  }),
};
