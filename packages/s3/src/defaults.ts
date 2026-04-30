import { BlockPublicAccess, BucketEncryption, type LifecycleRule } from "aws-cdk-lib/aws-s3";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type { BucketBuilderProps } from "./bucket-builder.js";

/**
 * Aborts multipart uploads that have not completed within 7 days. AWS recommends
 * this rule on every bucket — orphaned upload parts are billed as storage but
 * never become objects, so the rule is pure cost hygiene with no functional
 * downside.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html
 */
const ABORT_INCOMPLETE_MULTIPART_UPLOADS: LifecycleRule = {
  id: "AbortIncompleteMultipartUploadAfter7Days",
  abortIncompleteMultipartUploadAfter: Duration.days(7),
};

/**
 * Lifecycle rules applied to general-purpose buckets built with
 * {@link createBucketBuilder}. Bounds storage cost from orphaned multipart
 * parts and from accumulated noncurrent versions of objects in versioned
 * buckets, while preserving a generous recovery window.
 *
 * Users who need different rules can override the entire set via the
 * `.lifecycleRules([...])` builder method.
 */
export const DEFAULT_BUCKET_LIFECYCLE_RULES: LifecycleRule[] = [
  ABORT_INCOMPLETE_MULTIPART_UPLOADS,
  {
    /**
     * Buckets default to `versioned: true`, so replaced and deleted objects
     * accumulate as noncurrent versions indefinitely. Expiring them after a
     * year preserves a long recovery window for "oops" deletions while
     * preventing unbounded storage growth.
     *
     * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-configuration-examples.html
     */
    id: "ExpireNoncurrentVersionsAfter365Days",
    noncurrentVersionExpiration: Duration.days(365),
  },
];

/**
 * Lifecycle rules applied to auto-created S3 server access log buckets and
 * CloudFront access log buckets. Mirrors the 2-year retention used by
 * {@link LOG_GROUP_DEFAULTS} so the audit window is consistent across log
 * destinations in the library.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
 */
export const DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES: LifecycleRule[] = [
  ABORT_INCOMPLETE_MULTIPART_UPLOADS,
  {
    id: "ExpireAccessLogsAfter2Years",
    expiration: Duration.days(731),
  },
];

/**
 * Secure, AWS-recommended defaults applied to every S3 bucket built
 * with {@link createBucketBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const BUCKET_DEFAULTS: Partial<BucketBuilderProps> = {
  /**
   * Auto-create a dedicated logging bucket and write S3 server access logs
   * to it under the `logs/` prefix. Access logging provides an audit trail
   * of all object-level operations for security monitoring and
   * troubleshooting.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  serverAccessLogs: { prefix: "logs/" },

  /**
   * Block all public access to the bucket. S3 buckets should not be
   * publicly accessible unless explicitly required (e.g. static website
   * hosting via CloudFront OAC).
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html
   */
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,

  /**
   * Enable server-side encryption with S3-managed keys (SSE-S3).
   * This is the default and lowest-cost encryption option.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-at-rest.html
   */
  encryption: BucketEncryption.S3_MANAGED,

  /**
   * Enforce SSL/TLS for all requests to the bucket.
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html
   */
  enforceSSL: true,

  /**
   * Enable versioning to protect against accidental deletions and
   * support rollback.
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html
   */
  versioned: true,

  /**
   * Bound storage cost on every bucket: abort orphaned multipart uploads
   * after 7 days and expire noncurrent object versions after 365 days.
   *
   * Override with `.lifecycleRules([...])` to supply your own rule set —
   * the array is replaced wholesale, consistent with how every other
   * builder default is overridden.
   *
   * @see {@link DEFAULT_BUCKET_LIFECYCLE_RULES}
   */
  lifecycleRules: DEFAULT_BUCKET_LIFECYCLE_RULES,

  /**
   * Retain the bucket on stack deletion to prevent data loss.
   *
   * When overridden to `RemovalPolicy.DESTROY`, the builder automatically
   * enables `autoDeleteObjects` (unless explicitly set to `false`) so that
   * non-empty buckets can be cleanly removed during stack deletion.
   *
   * @see https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resources_removal
   */
  removalPolicy: RemovalPolicy.RETAIN,
};
