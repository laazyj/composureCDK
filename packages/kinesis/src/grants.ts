import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { IStream, IStreamConsumer } from "aws-cdk-lib/aws-kinesis";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link IStream}'s native grant methods as a capability helper. */
const capability =
  (apply: (stream: IStream, grantee: IGrantable) => void) =>
  (stream: Resolvable<IStream>): Grant<IGrantable> =>
    grantVia(stream, apply);

/**
 * Consumer-side grant helpers for a Kinesis data stream. Pass one to a grantee
 * builder's `grant(...)` — e.g.
 * `handler.grant(streamGrants.write(ref("stream", (r) => r.stream)))`.
 *
 * Each delegates to the stream's native `grant*` method, which also grants the
 * matching `kms:` actions on the stream's key when it is customer-managed. See
 * ADR-0013.
 */
export const streamGrants = {
  /** Read records (`kinesis:GetRecords`, `GetShardIterator`, `ListShards`, …; `kms:Decrypt`). */
  read: capability((stream, grantee) => {
    stream.grantRead(grantee);
  }),
  /** Write records (`kinesis:PutRecord`, `PutRecords`, …; `kms:GenerateDataKey*`, `kms:Encrypt`). */
  write: capability((stream, grantee) => {
    stream.grantWrite(grantee);
  }),
  /** Read and write records: the union of `read` and `write`. */
  readWrite: capability((stream, grantee) => {
    stream.grantReadWrite(grantee);
  }),
};

/**
 * Consumer-side grant helpers for a Kinesis enhanced fan-out stream consumer.
 * Pass one to a grantee builder's `grant(...)` — e.g.
 * `handler.grant(streamConsumerGrants.read(ref("alerter", (r) => r.consumer)))`.
 *
 * Delegates to the consumer's native `grantRead`. See ADR-0013.
 */
export const streamConsumerGrants = {
  /**
   * Read records through the consumer (`kinesis:SubscribeToShard`,
   * `DescribeStreamConsumer` on the consumer), plus everything
   * `streamGrants.read` grants on its stream, including `kms:Decrypt`.
   */
  read: (consumer: Resolvable<IStreamConsumer>): Grant<IGrantable> =>
    grantVia(consumer, (c, grantee) => {
      c.grantRead(grantee);
    }),
};
