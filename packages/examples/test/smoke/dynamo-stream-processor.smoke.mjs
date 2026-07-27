import { findStackResources, pollUntil, resolveLambdaLogGroup } from "./_helpers.mjs";

const STACK = "ComposureCDK-DynamoStreamProcessorStack";

// The example consumes the stream with the library default,
// `StartingPosition.LATEST` — the poller starts at the tip of each shard at
// the moment it attaches, which is some way after CloudFormation reports the
// mapping Enabled. A record written in that window sits *behind* the tip and
// is skipped permanently, so polling longer on a single write can never pass.
// Writing a fresh record each round instead converges as soon as the poller
// is live: rounds before it attaches are skipped, the first one after it is
// delivered.
const WRITE_ROUNDS = 8;
const ROUND_TIMEOUT_MS = 20_000;

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

    // Unique per run so the log poll can't match a stale change record from a
    // previous run. Every round's key carries this prefix, so one filter
    // pattern matches whichever round the consumer actually receives.
    const marker = `smoke-${process.pid}-${Date.now()}`;
    const firstWriteMs = Date.now();

    for (let round = 1; round <= WRITE_ROUNDS; round++) {
      // put-item prints nothing on success, and the runner's `aws` helper
      // always parses JSON — asking for consumed capacity gives it a body.
      aws(
        "dynamodb",
        "put-item",
        "--table-name",
        tableName,
        "--item",
        JSON.stringify({ pk: { S: `${marker}-${round}` } }),
        "--return-consumed-capacity",
        "TOTAL",
        "--output",
        "json",
      );

      // The handler logs each record's Keys, so a log line carrying the marker
      // proves the function was invoked AND its execution role could read the
      // stream and write logs.
      const processed = await pollUntil(
        () => {
          const { events } = aws(
            "logs",
            "filter-log-events",
            "--log-group-name",
            logGroup,
            "--start-time",
            String(firstWriteMs - 5_000),
            "--filter-pattern",
            `"${marker}"`,
            "--max-items",
            "1",
            "--output",
            "json",
          );
          return events && events.length > 0;
        },
        { timeoutMs: ROUND_TIMEOUT_MS, intervalMs: 3_000 },
      );

      if (processed) {
        pass(`${tableName} — change record written`);
        pass(`${fnName} — consumed and logged the stream change record (round ${round})`);
        return;
      }
    }

    // Nothing arrived across every round — report the mapping's own view, which
    // distinguishes "poller never attached" from "poller ran and failed".
    const { EventSourceMappings } = aws(
      "lambda",
      "list-event-source-mappings",
      "--function-name",
      fnName,
      "--output",
      "json",
    );
    const state = (EventSourceMappings ?? [])
      .map((m) => `${m.State} / ${m.LastProcessingResult}`)
      .join(", ");
    fail(
      `${logGroup} — no change record ${marker}-* processed across ${WRITE_ROUNDS} writes; event source mapping: ${state || "none found"}`,
    );
  },
};
