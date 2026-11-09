import {
  eventSourceMappingState,
  findStackResources,
  resolveLambdaLogGroup,
  waitForLogEvents,
} from "./_helpers.mjs";

const STACK = "ComposureCDK-DynamoStreamProcessorStack";
// The consumer is built with scoped(): its resources deploy under this
// construct, and its tags() hook reaches them and nothing else.
const CONSUMER_PATH = `${STACK}/DynamoStreamProcessor--consumer/`;
const CONSUMER_TAG_KEY = "Component";
const CONSUMER_TAG_VALUE = "orders-consumer";

// The example consumes the stream with the library default,
// `StartingPosition.LATEST` — the poller starts at the tip of each shard at
// the moment it attaches, which is some way after CloudFormation reports the
// mapping Enabled. A record written in that window sits *behind* the tip and
// is skipped permanently, so polling longer on a single write can never pass.
// Writing a fresh record each round instead converges as soon as the poller
// is live: rounds before it attaches are skipped, the first one after it is
// delivered.
const WRITE_ROUNDS = 8;
const ROUND_TIMEOUT_MS = 15_000;

export default {
  name: "DynamoDB stream processing checks",
  run: async ({ aws, pass, fail }) => {
    // One listing serves both lookups — the stack's resource set is fixed by
    // the time a post-deploy check runs.
    const resources = findStackResources(aws, STACK);
    // PhysicalResourceId of an AWS::DynamoDB::GlobalTable is the table name.
    const tableName = resources.find(
      (r) => r.ResourceType === "AWS::DynamoDB::GlobalTable",
    )?.PhysicalResourceId;
    const fnName = resources.find(
      (r) => r.ResourceType === "AWS::Lambda::Function",
    )?.PhysicalResourceId;
    if (!tableName || !fnName) {
      fail(
        `${STACK} — expected a table and a processor Lambda, found ${resources.length} resources`,
      );
      return;
    }
    // One read serves both the tag check and the log group lookup.
    const fn = aws("lambda", "get-function", "--function-name", fnName, "--output", "json");
    checkConsumerScope(aws, { fnName, tags: fn.Tags, pass, fail });
    const logGroup = resolveLambdaLogGroup(aws, fnName, fn.Configuration);

    // Unique per run so the log poll can't match a stale change record from a
    // previous run. Every round's key carries this prefix, so one filter
    // pattern matches whichever round the consumer actually receives.
    const startedMs = Date.now();
    const marker = `smoke-${process.pid}-${startedMs}`;

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
      if (round === 1) {
        pass(`${tableName} — change record written`);
      }

      // The handler logs each record's Keys, so a log line carrying the marker
      // proves the function was invoked AND its execution role could read the
      // stream and write logs.
      const processed = await waitForLogEvents(aws, {
        logGroup,
        sinceMs: startedMs,
        filterPattern: marker,
        timeoutMs: ROUND_TIMEOUT_MS,
        intervalMs: 5_000,
      });
      if (processed) {
        pass(`${fnName} — consumed and logged the stream change record (round ${round})`);
        return;
      }
    }

    // Nothing arrived across every round — report the mapping's own view, which
    // distinguishes "poller never attached" from "poller ran and failed".
    fail(
      `${logGroup} — no change record ${marker}-* processed across ${WRITE_ROUNDS} writes; event source mapping: ${eventSourceMappingState(aws, fnName)}`,
    );
  },
};

/**
 * Proves scoped() held in the deployed stack: the consumer's queue and function
 * sit under one construct while the table does not, and the subtree's tag
 * reached the live function.
 */
function checkConsumerScope(aws, { fnName, tags, pass, fail }) {
  const { TemplateBody } = aws(
    "cloudformation",
    "get-template",
    "--stack-name",
    STACK,
    "--output",
    "json",
  );
  const pathOf = (type) =>
    Object.values(TemplateBody.Resources).find((r) => r.Type === type)?.Metadata?.[
      "aws:cdk:path"
    ] ?? "";
  const nested = ["AWS::SQS::Queue", "AWS::Lambda::Function"].every((t) =>
    pathOf(t).startsWith(CONSUMER_PATH),
  );
  if (nested && !pathOf("AWS::DynamoDB::GlobalTable").startsWith(CONSUMER_PATH)) {
    pass(
      `${STACK} — consumer queue and function deployed under ${CONSUMER_PATH}, table outside it`,
    );
  } else {
    fail(`${STACK} — expected the queue and function, and only them, under ${CONSUMER_PATH}`);
  }

  if (tags?.[CONSUMER_TAG_KEY] === CONSUMER_TAG_VALUE) {
    pass(`${fnName} — carries the consumer's ${CONSUMER_TAG_KEY}=${CONSUMER_TAG_VALUE} tag`);
  } else {
    fail(
      `${fnName} — expected tag ${CONSUMER_TAG_KEY}=${CONSUMER_TAG_VALUE}, found ${JSON.stringify(tags ?? {})}`,
    );
  }
}
