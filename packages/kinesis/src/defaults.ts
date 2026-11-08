import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { StreamEncryption, type StreamProps } from "aws-cdk-lib/aws-kinesis";

/**
 * The default `retentionPeriod`, named so the iterator-age alarm baseline in
 * {@link STREAM_ALARM_DEFAULTS} can derive from it without a non-null
 * assertion on the `Partial` defaults.
 */
export const DEFAULT_RETENTION_PERIOD = Duration.hours(168);

/**
 * Secure, AWS-recommended defaults applied to every Kinesis data stream built
 * with {@link createStreamBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * `encryption` yields to a user-set `encryptionKey` — see the builder
 * (ADR-0009).
 *
 * Capacity mode is deliberately not defaulted: CDK's provisioned, single-shard
 * default is kept. The right mode depends on the workload's traffic shape and
 * budget, an on-demand stream carries a per-stream-hour charge that a casual
 * user would not expect, and a default that silently diverges from vanilla CDK
 * on cost is a surprise. Choose with `.streamMode(...)` / `.shardCount(...)`.
 * @see https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html
 */
export const STREAM_DEFAULTS: Partial<StreamProps> = {
  /**
   * Encrypt records at rest with the AWS-managed key (`alias/aws/kinesis`).
   * Satisfies Security Hub control Kinesis.1 at no key cost, and needs no
   * extra grants. CDK's own default reaches the same key through a
   * China-region `CfnCondition`; stating it keeps the template free of that
   * condition and stable across CDK versions.
   * @see https://docs.aws.amazon.com/securityhub/latest/userguide/kinesis-controls.html
   * @see https://docs.aws.amazon.com/streams/latest/dev/costs-performance.html
   */
  encryption: StreamEncryption.MANAGED,

  /**
   * Keep records for 7 days. Security Hub control Kinesis.3 fails a stream
   * retaining less than 168 hours, and a week of replay lets consumers recover
   * from an outage longer than the 24-hour minimum. Retention above 24 hours
   * is billed as extended retention.
   * @see https://docs.aws.amazon.com/config/latest/developerguide/kinesis-stream-backup-retention-check.html
   * @see https://aws.amazon.com/kinesis/data-streams/pricing/
   */
  retentionPeriod: DEFAULT_RETENTION_PERIOD,

  /**
   * Retain the stream, and the records still in it, when it is removed from
   * the stack. Matches CDK's default; stated so it is discoverable and stable.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_backing_up_data_identified_backups_data.html
   */
  removalPolicy: RemovalPolicy.RETAIN,
};
