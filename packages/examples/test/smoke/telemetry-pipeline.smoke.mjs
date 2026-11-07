import {
  eventSourceMappingState,
  findStackResources,
  getDynamoItem,
  pollUntil,
  putKinesisRecord,
  resolveLambdaLogGroup,
  waitForLogEvents,
} from "./_helpers.mjs";

const STACK = "ComposureCDK-TelemetryPipelineStack";

// Over the example's 80 °C anomaly threshold, so the alerter must log it.
const ANOMALOUS_TEMPERATURE = 120;

// Both event sources start at `StartingPosition.LATEST`, the library default:
// each poller (and the EFO subscription) starts at the tip of each shard when
// it attaches, which can be some way after CloudFormation reports the mapping
// Enabled. A record put in that window is skipped for good, so — as in the
// DynamoDB stream check — each round puts a fresh reading, and the check
// converges as soon as both consumers are live.
const PUT_ROUNDS = 10;
const ROUND_TIMEOUT_MS = 15_000;

function physicalId(resources, type, logicalIdPattern) {
  return resources.find(
    (r) => r.ResourceType === type && logicalIdPattern.test(r.LogicalResourceId),
  )?.PhysicalResourceId;
}

export default {
  name: "Kinesis telemetry pipeline checks",
  run: async ({ aws, pass, fail }) => {
    const resources = findStackResources(aws, STACK);
    // The PhysicalResourceId of a stream is its name, and of a GlobalTable its
    // table name.
    const streamName = physicalId(resources, "AWS::Kinesis::Stream", /readings/);
    const tableName = physicalId(resources, "AWS::DynamoDB::GlobalTable", /latestReadings/);
    const writerFn = physicalId(resources, "AWS::Lambda::Function", /latestReadingWriter/);
    const alerterFn = physicalId(resources, "AWS::Lambda::Function", /anomalyAlerter/);
    if (!streamName || !tableName || !writerFn || !alerterFn) {
      fail(
        `${STACK} — expected a stream, a table, and the writer and alerter functions, found ${resources.length} resources`,
      );
      return;
    }
    const alerterLogGroup = resolveLambdaLogGroup(aws, alerterFn);

    // A device id unique to this run, so neither the table nor the log can
    // match a reading from an earlier run.
    const startedMs = Date.now();
    const deviceId = `smoke-${process.pid}-${startedMs}`;
    let stored = false;
    let alerted = false;

    for (let round = 1; round <= PUT_ROUNDS && !(stored && alerted); round++) {
      // Putting the record proves the CI role can encrypt with the stream's
      // customer-managed key, as a real producer must.
      putKinesisRecord(aws, {
        streamName,
        partitionKey: deviceId,
        data: { deviceId, temperature: ANOMALOUS_TEMPERATURE, ts: Date.now() },
      });
      if (round === 1) pass(`${streamName} — reading put for ${deviceId}`);

      // Both consumers are polled within the same round, each until it shows
      // the reading or the round times out.
      const [alertedNow, storedNow] = await Promise.all([
        // The alerter logs `ANOMALY device=<id> …` only after decrypting and
        // parsing the record, so the line proves the EFO subscription, its
        // `kms:Decrypt` and the threshold check together.
        alerted ||
          waitForLogEvents(aws, {
            logGroup: alerterLogGroup,
            sinceMs: startedMs,
            filterPattern: `ANOMALY device=${deviceId}`,
            timeoutMs: ROUND_TIMEOUT_MS,
            intervalMs: 5_000,
          }),
        // The item proves the shared-throughput consumer read and decrypted
        // the record and its role could put to the table.
        stored ||
          pollUntil(
            () =>
              getDynamoItem(aws, tableName, { deviceId: { S: deviceId } })?.temperature?.N ===
              String(ANOMALOUS_TEMPERATURE),
            { timeoutMs: ROUND_TIMEOUT_MS, intervalMs: 5_000 },
          ),
      ]);
      if (alertedNow && !alerted) pass(`${alerterFn} — logged the anomaly (round ${round})`);
      if (storedNow && !stored) pass(`${tableName} — latest reading stored (round ${round})`);
      alerted = alertedNow;
      stored = storedNow;
    }

    if (!alerted) {
      fail(
        `${alerterLogGroup} — no ANOMALY line for ${deviceId} across ${PUT_ROUNDS} puts; event source mapping: ${eventSourceMappingState(aws, alerterFn)}`,
      );
    }
    if (!stored) {
      fail(
        `${tableName} — no reading stored for ${deviceId} across ${PUT_ROUNDS} puts; event source mapping: ${eventSourceMappingState(aws, writerFn)}`,
      );
    }
  },
};
