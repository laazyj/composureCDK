import { findStackResources, pollUntil, resolveLambdaLogGroup } from "./_helpers.mjs";

const STACK = "ComposureCDK-EventStoreStack";

export default {
  name: "DynamoDB stream projection checks",
  run: async ({ aws, pass, fail }) => {
    const [table] = findStackResources(aws, STACK, { type: "AWS::DynamoDB::GlobalTable" });
    if (!table) {
      fail(`${STACK} — event store table not found`);
      return;
    }
    // PhysicalResourceId of an AWS::DynamoDB::GlobalTable is the table name.
    const tableName = table.PhysicalResourceId;

    const [projectorFn] = findStackResources(aws, STACK, {
      type: "AWS::Lambda::Function",
      namePattern: /projector/i,
    });
    if (!projectorFn) {
      fail(`${STACK} — projector Lambda not found`);
      return;
    }
    const fnName = projectorFn.PhysicalResourceId;
    const logGroup = resolveLambdaLogGroup(aws, fnName);

    // Unique marker so the log poll can't match a stale event from a previous
    // run. It lands in the item's partition key, so the stream record's
    // NewImage — which the handler logs — carries it.
    const marker = `smoke-${process.pid}-${Date.now()}`;
    const startMs = Date.now();
    aws(
      "dynamodb",
      "put-item",
      "--table-name",
      tableName,
      "--item",
      JSON.stringify({
        aggregateId: { S: marker },
        sequence: { N: "1" },
        eventType: { S: "smoke.test" },
        occurredAt: { N: String(startMs) },
      }),
      "--output",
      "json",
    );
    pass(`${tableName} — event item written`);

    // The stream delivers the change to the projector; a log line carrying the
    // marker proves the function was invoked AND its execution role could read
    // the stream and write logs.
    const projected = await pollUntil(
      () => {
        const { events } = aws(
          "logs",
          "filter-log-events",
          "--log-group-name",
          logGroup,
          "--start-time",
          String(startMs - 5_000),
          "--filter-pattern",
          `"${marker}"`,
          "--max-items",
          "1",
          "--output",
          "json",
        );
        return events && events.length > 0;
      },
      { timeoutMs: 60_000, intervalMs: 3_000 },
    );

    if (projected) {
      pass(`${fnName} — projected the change-stream event`);
    } else {
      fail(`${logGroup} — event ${marker} not projected within 60s`);
    }
  },
};
