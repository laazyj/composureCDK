import { findStackResources, pollUntil } from "./_helpers.mjs";

const STACK = "ComposureCDK-FulfilmentWorkflowStack";
// Must match ORDER_EVENT_SOURCE in src/fulfilment-workflow-app.ts.
const SOURCE = "composurecdk.examples.orders";

// EventBridge delivery plus a cold Lambda and two task states: seconds in the
// normal case, generous here so a cold start never fails the check.
const OUTCOME_TIMEOUT_MS = 90_000;

/** Publishes one `OrderPlaced` event per order; the rule starts a fulfilment execution for each. */
function placeOrders(aws, orders) {
  const { FailedEntryCount, Entries } = aws(
    "events",
    "put-events",
    "--entries",
    JSON.stringify(
      orders.map((order) => ({
        Source: SOURCE,
        DetailType: "OrderPlaced",
        Detail: JSON.stringify(order),
      })),
    ),
    "--output",
    "json",
  );
  if (FailedEntryCount > 0) {
    throw new Error(`put-events rejected an order: ${JSON.stringify(Entries)}`);
  }
}

/** The status the workflow recorded for `orderId`, or `undefined` while there is none. */
function recordedStatus(aws, tableName, orderId) {
  const { Item } = aws(
    "dynamodb",
    "get-item",
    "--table-name",
    tableName,
    "--key",
    JSON.stringify({ orderId: { S: orderId } }),
    "--consistent-read",
    "--output",
    "json",
  );
  return Item?.status?.S;
}

export default {
  name: "Fulfilment workflow checks",
  run: async ({ aws, pass, fail }) => {
    const resources = findStackResources(aws, STACK);
    // PhysicalResourceId of an AWS::DynamoDB::GlobalTable is the table name.
    const tableName = resources.find(
      (r) => r.ResourceType === "AWS::DynamoDB::GlobalTable",
    )?.PhysicalResourceId;
    if (!tableName) {
      fail(`${STACK} — expected the orders table, found ${resources.length} resources`);
      return;
    }

    // Unique per run, so a status recorded by an earlier run can never match.
    const run = `smoke-${process.pid}-${Date.now()}`;
    const cases = [
      { orderId: `${run}-in-stock`, quantity: 2, expected: "ACCEPTED" },
      // Past the stock limit: the workflow's Catch records it and still succeeds.
      { orderId: `${run}-out-of-stock`, quantity: 50, expected: "REJECTED" },
    ];

    placeOrders(
      aws,
      cases.map(({ orderId, quantity }) => ({ orderId, sku: "WIDGET", quantity })),
    );

    // A recorded status proves the whole path: the rule started an execution,
    // the execution role could use the workflow's customer-managed key (whose
    // grant is scoped to the state machine's name), invoke the stock check and
    // write the table, and the Catch routed the business error. Both orders
    // share one deadline.
    const recorded = new Map();
    await pollUntil(
      () => {
        for (const { orderId } of cases) {
          if (!recorded.has(orderId)) {
            const status = recordedStatus(aws, tableName, orderId);
            if (status !== undefined) recorded.set(orderId, status);
          }
        }
        return recorded.size === cases.length;
      },
      { timeoutMs: OUTCOME_TIMEOUT_MS, intervalMs: 3_000 },
    );

    for (const { orderId, expected } of cases) {
      const status = recorded.get(orderId);
      if (status === undefined) {
        fail(
          `${orderId} — no status recorded within ${OUTCOME_TIMEOUT_MS / 1000}s — check the state machine's executions in ${STACK} (a KMS AccessDenied there means the key grant does not match the state machine)`,
        );
      } else if (status !== expected) {
        fail(`${orderId} — recorded ${status}, expected ${expected}`);
      } else {
        pass(`${orderId} — recorded ${status}`);
      }
    }
  },
};
