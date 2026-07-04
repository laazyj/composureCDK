import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link IBucket}'s native grant methods as a capability helper. */
const capability =
  (apply: (bucket: IBucket, grantee: IGrantable) => void) =>
  (bucket: Resolvable<IBucket>): Grant<IGrantable> =>
    grantVia(bucket, apply);

/**
 * Consumer-side grant helpers for an S3 bucket. Pass one to a grantee builder's
 * `grant(...)` — e.g.
 * `handler.grant(bucketGrants.write(ref("bucket", (r) => r.bucket)))`.
 *
 * Each delegates to the bucket's native `grant*` method, scoped to the whole
 * bucket (grant on a key prefix directly on the construct when needed). See
 * ADR-0013.
 */
export const bucketGrants = {
  /** Read objects (`s3:GetObject`, `ListBucket`, …). */
  read: capability((bucket, grantee) => {
    bucket.grantRead(grantee);
  }),
  /** Write and overwrite objects (`s3:PutObject`, `Abort*`, …). */
  write: capability((bucket, grantee) => {
    bucket.grantWrite(grantee);
  }),
  /** Combined read and write access. */
  readWrite: capability((bucket, grantee) => {
    bucket.grantReadWrite(grantee);
  }),
  /** Put objects without read (`s3:PutObject`). */
  put: capability((bucket, grantee) => {
    bucket.grantPut(grantee);
  }),
  /** Delete objects (`s3:DeleteObject`). */
  delete: capability((bucket, grantee) => {
    bucket.grantDelete(grantee);
  }),
};
