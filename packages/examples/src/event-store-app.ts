import { App, Duration, Stack } from "aws-cdk-lib";
import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, ref } from "@composurecdk/core";
import { createTableV2Builder, type TableV2BuilderResult } from "@composurecdk/dynamodb";
import { createFunctionBuilder, dynamoEventSource } from "@composurecdk/lambda";

/**
 * An event-sourcing store built on the recommended `createTableV2Builder`
 * (a `TableV2` / `AWS::DynamoDB::GlobalTable`), feeding a Lambda projector off
 * its change stream.
 *
 * The table gets ComposureCDK's secure DynamoDB defaults (on-demand billing,
 * AWS-managed KMS encryption, point-in-time recovery, deletion protection) and
 * the three AWS-recommended alarms (system errors, read/write throttle events);
 * the projector gets the recommended Lambda alarms (errors, throttles). The
 * alarms are created but left unrouted — wiring alarm actions to an SNS topic
 * via `alarmActionsPolicy` is shown in `order-processor-app.ts`.
 *
 * Demonstrates:
 * - `createTableV2Builder` with secure defaults plus a workload key schema
 * - A global secondary index (`by-type`) and a TTL attribute (`expiresAt`)
 * - A DynamoDB stream (`dynamoStream`) exposed for a downstream consumer
 * - Tuning a recommended alarm threshold via `recommendedAlarms` and adding a
 *   workload-specific alarm via `addAlarm`
 * - Wiring the stream to a `createFunctionBuilder` projector via the
 *   `dynamoEventSource` helper and a `ref` to the sibling table — resolved at
 *   build time, granting the projector's least-privilege role stream-read access
 *   and adding the stream `iteratorAge` + per-mapping event-source alarms.
 * - **Opt-in global-table replicas.** `TableV2`'s headline feature is
 *   cross-region replication. Replicas deploy to additional regions (extra
 *   cost, slower teardown, and each replica region must be CDK-bootstrapped and
 *   differ from the primary), so they are gated behind the `ddbReplicaRegions`
 *   CDK context flag and off by default — the example stays single-region and
 *   cheap for CI. Enable a real global table with, e.g.:
 *   `cdk synth -c ddbReplicaRegions=us-west-2,eu-west-1`.
 */
export function createEventStoreApp(app = new App()): { stack: Stack } {
  // Comma-separated replica regions, e.g. `-c ddbReplicaRegions=us-west-2`.
  const replicaRegions = (app.node.tryGetContext("ddbReplicaRegions") as string | undefined)
    ?.split(",")
    .map((region) => region.trim())
    .filter((region) => region.length > 0);

  // A TableV2 with replicas cannot live in a region-agnostic stack — CDK needs
  // a concrete primary region to validate replica regions differ from it. Pin
  // the environment only when replicas are requested; the default deploy stays
  // region-agnostic like every other example.
  const stack =
    replicaRegions && replicaRegions.length > 0
      ? new Stack(app, "ComposureCDK-EventStoreStack", {
          env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
          },
        })
      : new Stack(app, "ComposureCDK-EventStoreStack");

  let events = createTableV2Builder()
    // The key schema is the one property the builder never defaults — it is the
    // most workload-specific decision. An event store is keyed by aggregate and
    // ordered by sequence number within the aggregate.
    .partitionKey({ name: "aggregateId", type: AttributeType.STRING })
    .sortKey({ name: "sequence", type: AttributeType.NUMBER })
    // Query the whole stream by event type, newest first.
    .globalSecondaryIndexes([
      {
        indexName: "by-type",
        partitionKey: { name: "eventType", type: AttributeType.STRING },
        sortKey: { name: "occurredAt", type: AttributeType.NUMBER },
      },
    ])
    // Expire transient events automatically; durable events omit the attribute.
    .timeToLiveAttribute("expiresAt")
    // Surface every change so the projector can build read models. The build
    // result exposes `tableStreamArn`; the projector below consumes the table
    // itself via a DynamoEventSource.
    .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES)
    .recommendedAlarms({
      // Write throttling on an event store means lost writes — alert sooner
      // than a one-off blip but tolerate brief self-correcting bursts.
      writeThrottleEvents: { threshold: 1, evaluationPeriods: 3 },
    })
    .addAlarm("userErrors", (alarm) =>
      alarm
        .metric((table) => table.metricUserErrors({ period: Duration.minutes(5) }))
        .threshold(5)
        .greaterThan()
        .description(
          (def) =>
            `Event store is returning client-side (HTTP 400) errors — likely a malformed write or a bad key. ` +
            `Threshold: > ${String(def.threshold)} user errors per 5 minutes.`,
        ),
    );

  // Opt-in: turn the single-region table into a true global table.
  if (replicaRegions && replicaRegions.length > 0) {
    events = events.replicas(replicaRegions.map((region) => ({ region })));
  }

  compose(
    {
      events,

      projector: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        // Logs each change record's new image so the post-deploy smoke test can
        // prove the projector is wired and its role can read the stream.
        .code(
          Code.fromInline(
            "exports.handler = async (event) => { for (const r of event.Records) console.log('event', JSON.stringify(r.dynamodb && r.dynamodb.NewImage)); };",
          ),
        )
        .memorySize(256)
        .description("Event projector — consumes the change stream and builds read models")
        // `dynamoEventSource` resolves the sibling table `ref` at build time and
        // applies secure defaults (start at the stream tip, report partial batch
        // failures, enable the ESM EventCount metrics). `addEventSource` grants
        // the projector's least-privilege role `grantStreamRead`, and — because
        // the source is recognised as a stream — adds the `iteratorAge`
        // stall alarm plus the per-mapping failed/dropped-event alarms.
        .addEventSource(
          "events",
          dynamoEventSource(ref("events", (r: TableV2BuilderResult) => r.table)),
        ),
    },
    { events: [], projector: ["events"] },
  ).build(stack, "EventStore");

  return { stack };
}
