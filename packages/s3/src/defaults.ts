import { BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { RemovalPolicy } from "aws-cdk-lib";
import type { BucketBuilderProps } from "./bucket-builder.js";

/**
 * Secure, AWS-recommended defaults applied to every S3 bucket built
 * with {@link createBucketBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const BUCKET_DEFAULTS: Partial<BucketBuilderProps> = {
  /**
   * Automatically create an access logging bucket for S3 server access logs.
   * Access logging provides an audit trail of all object-level operations for
   * security monitoring and troubleshooting.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  accessLogging: true,

  /**
   * Default prefix for server access log object keys in the auto-created
   * logging bucket.
   */
  accessLogsPrefix: "logs/",

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
