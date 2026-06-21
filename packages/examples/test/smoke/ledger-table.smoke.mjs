import { findStackResources } from "./_helpers.mjs";

const STACK = "ComposureCDK-LedgerTableStack";

export default {
  name: "Ledger table CMK + read/write checks",
  run: async ({ aws, pass, fail }) => {
    const [table] = findStackResources(aws, STACK, { type: "AWS::DynamoDB::Table" });
    if (!table) {
      fail(`${STACK} — ledger table not found`);
      return;
    }
    // PhysicalResourceId of an AWS::DynamoDB::Table is the table name.
    const tableName = table.PhysicalResourceId;

    // The example's headline feature is customer-managed-key encryption — assert
    // the live table is encrypted with a KMS key, not the AWS-owned default.
    const { Table } = aws(
      "dynamodb",
      "describe-table",
      "--table-name",
      tableName,
      "--output",
      "json",
    );
    const sse = Table?.SSEDescription;
    if (sse?.SSEType === "KMS" && sse?.KMSMasterKeyArn) {
      pass(`${tableName} — encrypted with customer-managed key ${sse.KMSMasterKeyArn}`);
    } else {
      fail(`${tableName} — expected KMS (customer-managed) encryption, got ${JSON.stringify(sse)}`);
      return;
    }

    // Unique marker so the read-back can't match a stale item from a previous run.
    const marker = `smoke-${process.pid}-${Date.now()}`;
    const key = {
      accountId: { S: marker },
      txnId: { S: "1" },
    };
    aws(
      "dynamodb",
      "put-item",
      "--table-name",
      tableName,
      "--item",
      JSON.stringify({ ...key, amount: { N: "100" } }),
      "--output",
      "json",
    );

    // A consistent read proves the provisioned, CMK-encrypted table is writable
    // and readable end-to-end (write + KMS decrypt on read both succeeded).
    const { Item } = aws(
      "dynamodb",
      "get-item",
      "--table-name",
      tableName,
      "--key",
      JSON.stringify(key),
      "--consistent-read",
      "--output",
      "json",
    );
    if (Item?.accountId?.S === marker && Item?.amount?.N === "100") {
      pass(`${tableName} — wrote and read back ledger item ${marker}`);
    } else {
      fail(`${tableName} — round-trip read mismatch for ${marker}: ${JSON.stringify(Item)}`);
    }
  },
};
