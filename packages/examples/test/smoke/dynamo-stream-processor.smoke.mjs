import { findStackResources, pollUntil, resolveLambdaLogGroup } from "./_helpers.mjs";

const STACK = "ComposureCDK-DynamoStreamProcessorStack";

export default {
  name: "DynamoDB stream processing checks",
  run: async ({ aws, pass, fail }) => {
    const [table] = findStackResources(aws, STACK, { type: "AWS::DynamoDB::GlobalTable" });
    if (!table) {
      fail(`${STACK} — orders table not found`);
      return;
    }
    // PhysicalResourceId of an AWS::DynamoDB::GlobalTable is the table name.
    const tableName = table.PhysicalResourceId;

    const [processorFn] = findStackResources(aws, STACK, {
      type: "AWS::Lambda::Function",
      namePattern: /processor/i,
    });
    if (!processorFn) {
      fail(`${STACK} — processor Lambda not found`);
      return;
    }
    const fnName = processorFn.PhysicalResourceId;
    const logGroup = resolveLambdaLogGroup(aws, fnName);

    // Unique partition key so the log poll can't match a stale change record
    // from a previous run. The handler logs the record's Keys, so the marker
    // travels table -> stream -> consumer -> logs.
    const marker = `smoke-${process.pid}-${Date.now()}`;
    const writeStartMs = Date.now();
    // put-item prints nothing on success, and the runner's `aws` helper always
    // parses JSON — asking for consumed capacity gives it a body to parse.
    aws(
      "dynamodb",
      "put-item",
      "--table-name",
      tableName,
      "--item",
      JSON.stringify({ pk: { S: marker } }),
      "--return-consumed-capacity",
      "TOTAL",
      "--output",
      "json",
    );
    pass(`${tableName} — change record written`);

    // The stream event source delivers the change record to the consumer; a
    // log line carrying the marker proves the function was invoked AND its
    // execution role could read the stream and write logs.
    const processed = await pollUntil(
      () => {
        const { events } = aws(
          "logs",
          "filter-log-events",
          "--log-group-name",
          logGroup,
          "--start-time",
          String(writeStartMs - 5_000),
          "--filter-pattern",
          `"${marker}"`,
          "--max-items",
          "1",
          "--output",
          "json",
        );
        return events && events.length > 0;
      },
      { timeoutMs: 90_000, intervalMs: 3_000 },
    );

    if (processed) {
      pass(`${fnName} — consumed and logged the stream change record`);
    } else {
      fail(`${logGroup} — change record ${marker} not processed within 90s`);
    }
  },
};
