import { Duration, Stack } from "aws-cdk-lib";
import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { tags } from "@composurecdk/cloudformation";
import { compose, ref, scoped } from "@composurecdk/core";
import { createTableV2Builder, type TableV2BuilderResult } from "@composurecdk/dynamodb";
import { createFunctionBuilder, dynamoEventSource } from "@composurecdk/lambda";
import { createQueueBuilder, type QueueBuilderResult } from "@composurecdk/sqs";
import { exampleApp } from "./app-context.js";

/**
 * A DynamoDB table streaming change events to a Lambda processor, with a
 * dead-letter queue for records that exhaust their retries. This is the
 * operationally-healthy shape AWS recommends for stream consumers:
 *
 * - The table enables a stream (`NEW_AND_OLD_IMAGES`) and, by default, gets
 *   PITR, deletion protection, and the recommended DynamoDB alarms.
 * - `dynamoEventSource` applies the secure stream defaults (start at the tip,
 *   partial-batch reporting, **bisect on error** so one poison record cannot
 *   block a shard). Here it also bounds `retryAttempts` and wires an SQS DLQ
 *   via `onFailure` — so exhausted records are captured rather than dropped,
 *   and the stream dead-letter relationship guard stays silent.
 * - The DLQ is a `createQueueBuilder("dlq")` sibling (14-day retention + the
 *   recommended depth alarm); `onFailure: ref("dlq", …)` wires it declaratively
 *   — the factory wraps the queue in an `SqsDlq` for you.
 * - The processor and its DLQ are one unit, owned by the team that consumes
 *   the stream, so they are composed as their own system and wrapped in
 *   `scoped()`. They build under a single `DynamoStreamProcessor--consumer`
 *   construct, and the inner `tags()` hook reaches that subtree alone: the
 *   consumer's resources carry `Component=orders-consumer`, the table does
 *   not. The processor still reaches the outer `orders` table through the
 *   parent context.
 * - The processor gets the recommended Lambda alarms plus the stream contextual
 *   alarms (`IteratorAge`, failed-invocation, dropped-event) once the source is
 *   attached, and least-privilege `grantStreamRead` on the table's stream.
 */
export function createDynamoStreamProcessorApp(app = exampleApp()) {
  const stack = new Stack(app, "ComposureCDK-DynamoStreamProcessorStack");

  compose(
    {
      orders: createTableV2Builder()
        .partitionKey({ name: "pk", type: AttributeType.STRING })
        // NEW_AND_OLD_IMAGES gives the consumer both the before and after of
        // each change — the most flexible view for downstream processing.
        .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES),

      consumer: scoped(
        compose(
          {
            dlq: createQueueBuilder("dlq")
              .queueName("orders-stream-dlq")
              // Retain failed records for the full SQS maximum so an incident
              // can be triaged and replayed. (The dlq role already defaults to
              // 14 days; stated here for the example's benefit.)
              .retentionPeriod(Duration.days(14)),

            processor: createFunctionBuilder()
              .runtime(Runtime.NODEJS_22_X)
              .handler("index.handler")
              // Logs each change record so the post-deploy smoke test can
              // prove the consumer is wired and its role can read the stream.
              .code(
                Code.fromInline(
                  "exports.handler = async (event) => { for (const r of event.Records) console.log('processed change', r.eventName, JSON.stringify(r.dynamodb?.Keys)); };",
                ),
              )
              .memorySize(256)
              .description("DynamoDB stream processor - consumes table change events")
              // Declared as data: the table and DLQ refs resolve at build time.
              // `orders` comes from the outer system. Bounded retries + an
              // onFailure DLQ = durable failure handling.
              .addEventSource(
                "orders",
                dynamoEventSource(
                  ref("orders", (r: TableV2BuilderResult) => r.table),
                  {
                    retryAttempts: 3,
                    onFailure: ref("dlq", (r: QueueBuilderResult) => r.queue),
                  },
                ),
              ),
          },
          { dlq: [], processor: ["dlq"] },
        ).afterBuild(tags({ system: { Component: "orders-consumer" } })),
      ),
    },
    {
      orders: [],
      consumer: ["orders"],
    },
  ).build(stack, "DynamoStreamProcessor");

  return { stack };
}
