import { Duration, Stack } from "aws-cdk-lib";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, ref } from "@composurecdk/core";
import {
  createTableV2Builder,
  tableGrants,
  type TableV2BuilderResult,
} from "@composurecdk/dynamodb";
import {
  createStreamBuilder,
  createStreamConsumerBuilder,
  type StreamBuilderResult,
  type StreamConsumerBuilderResult,
} from "@composurecdk/kinesis";
import { createKeyBuilder, type KeyBuilderResult } from "@composurecdk/kms";
import {
  createFunctionBuilder,
  kinesisConsumerEventSource,
  kinesisEventSource,
} from "@composurecdk/lambda";
import { createQueueBuilder, type QueueBuilderResult } from "@composurecdk/sqs";
import { exampleApp } from "./app-context.js";

/**
 * The stream's name. Set explicitly, with the `ComposureCDK-` prefix, because
 * the post-deploy smoke test plays the device fleet: the CI role's
 * `kinesis:PutRecord` grant is scoped to `stream/ComposureCDK-*`, and a name
 * CloudFormation generated would leave that scope to chance.
 */
export const TELEMETRY_STREAM_NAME = "ComposureCDK-telemetry-readings";

/** Readings above this many degrees Celsius are anomalies. */
const ANOMALY_THRESHOLD_CELSIUS = 80;

/**
 * Keeps each device's most recent reading. Every record is a JSON reading
 * `{ deviceId, temperature, ts }`, base64-encoded by the Lambda service.
 *
 * The put is conditional on `ts`, so a replayed or retried batch never
 * overwrites a newer reading with an older one. Kinesis orders records per
 * partition key (the device id), so in the normal case the condition always
 * holds.
 *
 * On a failure it reports the failing record and stops: with
 * `reportBatchItemFailures`, Lambda resumes the shard from the lowest reported
 * sequence number, so processing past a failure would only be repeated.
 */
const LATEST_READING_HANDLER = `
const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const dynamodb = new DynamoDBClient({});

exports.handler = async (event) => {
  for (const record of event.Records) {
    try {
      const reading = JSON.parse(Buffer.from(record.kinesis.data, "base64").toString("utf8"));
      await dynamodb.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          deviceId: { S: String(reading.deviceId) },
          temperature: { N: String(reading.temperature) },
          ts: { N: String(reading.ts) },
        },
        ConditionExpression: "attribute_not_exists(deviceId) OR ts < :ts",
        ExpressionAttributeValues: { ":ts": { N: String(reading.ts) } },
      }));
      console.log("stored latest reading device=" + reading.deviceId);
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") continue;
      console.error("failed record", record.kinesis.sequenceNumber, err);
      return { batchItemFailures: [{ itemIdentifier: record.kinesis.sequenceNumber }] };
    }
  }
  return { batchItemFailures: [] };
};
`;

/**
 * Logs a recognisable `ANOMALY` line for every reading over the threshold —
 * the hook a CloudWatch Logs metric filter or subscription would page from.
 *
 * It never fails a batch: an alert is only useful while it is fresh, so a
 * malformed record is logged and skipped rather than retried, and the
 * alerter needs no dead-letter queue.
 */
const ANOMALY_ALERTER_HANDLER = `
const THRESHOLD = Number(process.env.THRESHOLD_CELSIUS);

exports.handler = async (event) => {
  for (const record of event.Records) {
    let reading;
    try {
      reading = JSON.parse(Buffer.from(record.kinesis.data, "base64").toString("utf8"));
    } catch {
      console.warn("skipping malformed record", record.kinesis.sequenceNumber);
      continue;
    }
    if (reading.temperature > THRESHOLD) {
      console.log("ANOMALY device=" + reading.deviceId + " temperature=" + reading.temperature);
    }
  }
};
`;

/**
 * An IoT telemetry pipeline. Devices put temperature readings onto a Kinesis
 * data stream, partitioned by device id, and two independent applications
 * read it:
 *
 * - **Latest-reading writer** — a shared-throughput consumer
 *   (`kinesisEventSource`) that keeps each device's latest reading in a
 *   DynamoDB table, for a dashboard or a device API to read. It is the
 *   stream's system of record, so a failing record must not be lost or block
 *   its shard: the library's stream defaults (start at the tip,
 *   partial-batch reporting, bisect on error) apply, retries are bounded by
 *   count and record age, and `onFailure` sends what is left to a
 *   `createQueueBuilder("dlq")` sibling. A queue receives the failed batch's
 *   shard and sequence-number range, not its records, which is why the
 *   record-age bound is an hour against the stream's seven-day retention:
 *   there is ample time to read them back.
 * - **Anomaly alerter** — an enhanced fan-out consumer
 *   (`createStreamConsumerBuilder`, attached with
 *   `kinesisConsumerEventSource`). Alerting is latency-sensitive, and EFO
 *   gives it its own 2 MB/s per shard, pushed to it over HTTP/2, rather than
 *   sharing the shard's polled read throughput with the writer. A third
 *   application could join the same way without slowing either.
 *
 * The stream is encrypted with a customer-managed KMS key composed as a
 * sibling, as in the crud-api example. No KMS grant appears here: each event
 * source binds with the stream's (or consumer's) `grantRead`, which reaches
 * the key's `kms:Decrypt`. A producer would get `kms:GenerateDataKey` the same
 * way, from `streamGrants.write`.
 *
 * Every component brings its recommended alarms: the stream's throttling,
 * success-rate and iterator-age alarms, the EFO consumer's
 * `MillisBehindLatest`, and each function's `IteratorAge` plus per-mapping
 * failed-invocation and dropped-event alarms. Routing them is left out; the
 * order-processor and EC2 examples show that.
 */
export function createTelemetryPipelineApp(app = exampleApp()) {
  const stack = new Stack(app, "ComposureCDK-TelemetryPipelineStack");

  compose(
    {
      streamKey: createKeyBuilder()
        .description("Encrypts the telemetry stream at rest.")
        .alias("composurecdk-examples/telemetry-pipeline/readings"),

      // A week's retention and RETAIN are library defaults; supplying the key
      // switches encryption from the AWS-managed key to KMS. Capacity mode is
      // a workload decision the library leaves to you: a fleet's steady
      // trickle of readings fits one provisioned shard (1 MB/s, 1,000
      // records/s of writes) — the cheapest idle stream. A spiky or unknown
      // load would use `.streamMode(StreamMode.ON_DEMAND)` instead.
      readings: createStreamBuilder()
        .streamName(TELEMETRY_STREAM_NAME)
        .shardCount(1)
        .encryptionKey(ref<KeyBuilderResult>("streamKey").get("key")),

      latestReadings: createTableV2Builder().partitionKey({
        name: "deviceId",
        type: AttributeType.STRING,
      }),

      latestReadingDlq: createQueueBuilder("dlq").queueName("telemetry-latest-reading-dlq"),

      latestReadingWriter: createFunctionBuilder()
        .runtime(Runtime.NODEJS_24_X)
        .handler("index.handler")
        .code(Code.fromInline(LATEST_READING_HANDLER))
        .timeout(Duration.seconds(30))
        .description("Telemetry pipeline - stores each device's latest reading")
        .environment({
          TABLE_NAME: ref("latestReadings", (r: TableV2BuilderResult) => r.table.tableName),
        })
        // Put only: the writer never reads, updates or deletes.
        .grant(tableGrants.put(ref("latestReadings", (r: TableV2BuilderResult) => r.table)))
        .addEventSource(
          "readings",
          kinesisEventSource(
            ref("readings", (r: StreamBuilderResult) => r.stream),
            {
              retryAttempts: 3,
              maxRecordAge: Duration.hours(1),
              onFailure: ref("latestReadingDlq", (r: QueueBuilderResult) => r.queue),
            },
          ),
        ),

      anomalyAlerterConsumer: createStreamConsumerBuilder()
        .streamConsumerName("anomaly-alerter")
        .stream(ref<StreamBuilderResult>("readings").get("stream")),

      anomalyAlerter: createFunctionBuilder()
        .runtime(Runtime.NODEJS_24_X)
        .handler("index.handler")
        .code(Code.fromInline(ANOMALY_ALERTER_HANDLER))
        .description("Telemetry pipeline - logs readings over the anomaly threshold")
        .environment({ THRESHOLD_CELSIUS: String(ANOMALY_THRESHOLD_CELSIUS) })
        .addEventSource(
          "readings",
          kinesisConsumerEventSource(
            ref("anomalyAlerterConsumer", (r: StreamConsumerBuilderResult) => r.consumer),
          ),
        ),
    },
    {
      streamKey: [],
      readings: ["streamKey"],
      latestReadings: [],
      latestReadingDlq: [],
      latestReadingWriter: ["readings", "latestReadings", "latestReadingDlq"],
      anomalyAlerterConsumer: ["readings"],
      anomalyAlerter: ["anomalyAlerterConsumer"],
    },
  ).build(stack, "TelemetryPipeline");

  return { stack };
}
