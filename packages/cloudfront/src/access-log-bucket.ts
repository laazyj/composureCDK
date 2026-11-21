import { RemovalPolicy } from "aws-cdk-lib";
import { type ObjectOwnership } from "aws-cdk-lib/aws-s3";
import {
  DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES,
  createBucketBuilder,
  type IBucketBuilder,
} from "@composurecdk/s3";

/**
 * The sub-builder both access-log buckets start from: legacy logging's and
 * standard logging (v2)'s. They differ only in object ownership, because
 * legacy logging writes through ACLs and v2 does not.
 *
 * Versioning is off and the bucket is retained on removal. S3 server access
 * logging is off, so the log bucket does not log to a bucket of its own. The
 * lifecycle rules are the only thing that bounds the bucket's growth, since
 * CloudFront never deletes its logs.
 *
 * @internal
 */
export function accessLogBucketBuilder(objectOwnership: ObjectOwnership): IBucketBuilder {
  return createBucketBuilder()
    .serverAccessLogs(false)
    .versioned(false)
    .objectOwnership(objectOwnership)
    .removalPolicy(RemovalPolicy.RETAIN)
    .lifecycleRules(DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES);
}
