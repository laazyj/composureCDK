import { Annotations, Aws, type CfnResource, Names, Stack, Token } from "aws-cdk-lib";
import { type IDistribution } from "aws-cdk-lib/aws-cloudfront";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  CfnDelivery,
  CfnDeliveryDestination,
  CfnDeliverySource,
  type ILogGroup,
} from "aws-cdk-lib/aws-logs";
import { type Bucket, type IBucket, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct, type IConstruct, type IDependable } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { type IBucketBuilder } from "@composurecdk/s3";
import { accessLogBucketBuilder } from "./access-log-bucket.js";
import { STANDARD_LOGGING_S3_OUTPUT_FORMAT } from "./defaults.js";

/**
 * The output formats CloudFront standard logging (v2) documents. Listed for
 * editor completion only: `outputFormat` takes any string, as CloudFormation
 * does, so a format AWS adds later works without a release of this package.
 */
export type StandardLoggingOutputFormat = "json" | "plain" | "w3c" | "raw" | "parquet";

/**
 * Deliver to an S3 bucket — auto-created and ACL-free unless `bucket` is
 * given. The bucket may be in any region.
 */
export interface StandardLoggingS3Destination {
  s3: {
    /**
     * Deliver to this bucket instead of auto-creating one. Its name must
     * match `[\w-]` (no dots). A bucket defined in this CDK app gets the
     * delivery statement added to its bucket policy; for an imported bucket
     * you own that policy. Cannot be combined with {@link configure}.
     */
    bucket?: Resolvable<IBucket>;

    /**
     * Key prefix for the log objects. It **replaces** CloudFront's default
     * `AWSLogs/<account-id>/CloudFront/` path rather than preceding it.
     */
    prefix?: string;

    /**
     * Customize the auto-created bucket's sub-builder. Receives a builder
     * pre-seeded with `objectOwnership: BUCKET_OWNER_ENFORCED`,
     * `versioned: false`, `removalPolicy: RETAIN`, the default access-log
     * lifecycle rules, and S3 server access logging disabled. Cannot be
     * combined with {@link bucket}.
     */
    configure?: (b: IBucketBuilder) => IBucketBuilder;
  };
}

/**
 * Deliver to a CloudWatch Logs log group, which should be in `us-east-1`. A
 * log group defined in this CDK app gets a resource policy statement for
 * `delivery.logs.amazonaws.com`.
 */
export interface StandardLoggingLogGroupDestination {
  logGroup: Resolvable<ILogGroup>;
}

/**
 * Deliver to a delivery destination you manage — the escape hatch for
 * Firehose, cross-account delivery, or anything the other options don't
 * cover. You own the destination's permissions, its output format, and its
 * region (a Firehose stream must be in `us-east-1`).
 */
export interface StandardLoggingDeliveryDestinationArn {
  deliveryDestinationArn: Resolvable<string>;
}

/** Where CloudFront standard logging (v2) delivers to. */
export type StandardLoggingDestination =
  | StandardLoggingS3Destination
  | StandardLoggingLogGroupDestination
  | StandardLoggingDeliveryDestinationArn;

/**
 * Configuration for {@link createCloudFrontLogDeliveryBuilder}: CloudFront
 * standard logging (v2), with access logs delivered through CloudWatch Logs
 * vended-log delivery. Unlike the legacy option, an S3 destination is granted
 * through its bucket policy, so the bucket keeps ACLs disabled.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html
 */
export interface CloudFrontLogDeliveryBuilderProps {
  /** @default `{ s3: {} }` — an auto-created, ACL-free bucket. */
  destination?: StandardLoggingDestination;

  /**
   * Log file format. Can't be changed in place: a new value replaces the
   * delivery destination. Not allowed with `deliveryDestinationArn`, whose
   * format is set where the destination is defined.
   * @default "w3c" for S3, the service default for a log group
   */
  // `string & {}` keeps editor completion for the known formats while
  // accepting any string.
  outputFormat?: StandardLoggingOutputFormat | (string & {});

  /**
   * S3 only: use Hive-compatible paths. The builder needs to know, because
   * without a prefix it changes the path the bucket policy must grant.
   *
   * The delivery's other settings — `RecordFields`, `FieldDelimiter`,
   * `S3SuffixPath` — don't affect what the builder creates, so they are not
   * options here: set them on the `CfnDelivery` in the build result,
   * typed by the aws-cdk-lib you have installed.
   */
  s3EnableHiveCompatiblePath?: boolean;
}

/**
 * Standard logging (v2) as configured on a distribution, through
 * `accessLogs({ v2: {...} })`. The delivery is built in the distribution's
 * stack by a {@link ICloudFrontLogDeliveryBuilder}, so it is configured
 * through that builder: there is one set of options, whether the delivery is
 * built here or on its own.
 *
 * The delivery source must be created in `us-east-1`, so the distribution's
 * stack must be deployed there.
 */
export interface StandardLoggingConfig {
  /**
   * Configure the delivery builder. It is pre-seeded with the distribution;
   * with no callback it delivers to an auto-created, ACL-free bucket.
   *
   * The callback runs before the build, and anything the builder accepts as
   * a `Resolvable` — a destination bucket or log group, say — can be a `ref`
   * to a sibling component. Declare that component as a dependency.
   */
  configure?: (b: ICloudFrontLogDeliveryBuilder) => ICloudFrontLogDeliveryBuilder;

  /**
   * Include cookies in the logs. A distribution-wide setting, so the
   * distribution builder renders it on the distribution, not the delivery.
   */
  includeCookies?: boolean;
}

/** The CloudWatch Logs resources that deliver a distribution's standard logs (v2). */
export interface StandardLogDelivery {
  source: CfnDeliverySource;
  /** `undefined` when the destination was given by `deliveryDestinationArn`. */
  destination?: CfnDeliveryDestination;
  delivery: CfnDelivery;
}

/** The build output of an {@link ICloudFrontLogDeliveryBuilder}. */
export interface CloudFrontLogDeliveryBuilderResult extends StandardLogDelivery {
  /** The bucket the builder created, when the destination is an auto-created one. */
  bucket?: Bucket;
}

/**
 * A fluent builder for a CloudFront distribution's standard logging (v2)
 * delivery: the delivery source, destination and delivery, and an ACL-free
 * S3 bucket when the destination is auto-created.
 *
 * @see {@link createCloudFrontLogDeliveryBuilder}
 */
export type ICloudFrontLogDeliveryBuilder = ITaggedBuilder<
  CloudFrontLogDeliveryBuilderProps,
  CloudFrontLogDeliveryBuilder
>;

const DELIVERY_REGION = "us-east-1";
const LOG_DELIVERY_PRINCIPAL = "delivery.logs.amazonaws.com";
const REGION_WARNING_ID = "@composurecdk/cloudfront:log-delivery-region";

class CloudFrontLogDeliveryBuilder implements Lifecycle<CloudFrontLogDeliveryBuilderResult> {
  props: Partial<CloudFrontLogDeliveryBuilderProps> = {};
  #distribution?: Resolvable<IDistribution>;

  /**
   * Sets the distribution whose access logs are delivered. It is only
   * referenced, so it may live in another stack.
   */
  distribution(distribution: Resolvable<IDistribution>): this {
    this.#distribution = distribution;
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: CloudFrontLogDeliveryBuilder): void {
    target.#distribution = this.#distribution;
  }

  /**
   * Creates a construct `id` in `scope` holding the delivery source,
   * destination and delivery, and the bucket when one is auto-created.
   * `scope` must be in `us-east-1`.
   */
  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): CloudFrontLogDeliveryBuilderResult {
    if (!this.#distribution) {
      throw new Error(
        `CloudFrontLogDeliveryBuilder "${id}" requires a distribution. ` +
          `Call .distribution() with a distribution or a Ref to one.`,
      );
    }
    const distribution = resolve(this.#distribution, context);
    const { destination = { s3: {} }, outputFormat, s3EnableHiveCompatiblePath } = this.props;
    validate(this.props, destination);
    errorIfStackNotUsEast1(scope);

    const container = new Construct(scope, id);
    // Derived from the construct path, so it stays stable across deploys: a
    // distribution can have only one delivery source, so replacing the source
    // (create-before-delete) would always fail. Sources and destinations are
    // separate namespaces, so the destination reuses the name.
    const name = Names.uniqueResourceName(container, { maxLength: 60 });
    const source = new CfnDeliverySource(container, "Source", {
      name,
      logType: "ACCESS_LOGS",
      // The partition is the pseudo-parameter, not the stack's: a literal
      // partition would make the template depend on the
      // `@aws-cdk/core:enablePartitionLiterals` feature flag.
      resourceArn: Stack.of(distribution).formatArn({
        partition: Aws.PARTITION,
        service: "cloudfront",
        region: "",
        resource: "distribution",
        resourceName: distribution.distributionId,
      }),
    });
    const sourceConditions: SourceConditions = {
      StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID },
      ArnLike: {
        "aws:SourceArn": `arn:${Aws.PARTITION}:logs:${DELIVERY_REGION}:${Aws.ACCOUNT_ID}:delivery-source:${source.name}`,
      },
    };

    let bucket: Bucket | undefined;
    let deliveryDestination: CfnDeliveryDestination | undefined;
    let destinationArn: string;
    const dependencies: IDependable[] = [];

    if ("deliveryDestinationArn" in destination) {
      destinationArn = resolve(destination.deliveryDestinationArn, context);
    } else {
      const target =
        "logGroup" in destination
          ? logGroupTarget(container, resolve(destination.logGroup, context), sourceConditions)
          : s3Target(
              container,
              destination.s3,
              s3EnableHiveCompatiblePath,
              sourceConditions,
              context,
            );
      bucket = target.bucket;
      dependencies.push(...target.dependencies);

      deliveryDestination = new CfnDeliveryDestination(container, "Destination", {
        name,
        destinationResourceArn: target.resourceArn,
      });
      const format =
        outputFormat ?? ("s3" in destination ? STANDARD_LOGGING_S3_OUTPUT_FORMAT : undefined);
      // Properties newer than this package's aws-cdk-lib floor are written as
      // overrides, which render the same on every aws-cdk-lib version.
      overrideIfSet(deliveryDestination, "OutputFormat", format);
      destinationArn = deliveryDestination.attrArn;
    }

    const delivery = new CfnDelivery(container, "Delivery", {
      deliverySourceName: source.name,
      deliveryDestinationArn: destinationArn,
    });
    delivery.node.addDependency(source, ...dependencies);
    overrideIfSet(delivery, "S3EnableHiveCompatiblePath", s3EnableHiveCompatiblePath);

    return { source, destination: deliveryDestination, delivery, bucket };
  }
}

/**
 * Creates a new {@link ICloudFrontLogDeliveryBuilder}, which delivers a
 * CloudFront distribution's access logs through standard logging (v2).
 * {@link createDistributionBuilder} uses it for `accessLogs({ v2: {...} })`.
 *
 * @internal Not yet exported from the package.
 */
export function createCloudFrontLogDeliveryBuilder(): ICloudFrontLogDeliveryBuilder {
  return taggedBuilder<CloudFrontLogDeliveryBuilderProps, CloudFrontLogDeliveryBuilder>(
    CloudFrontLogDeliveryBuilder,
  );
}

/** What a delivery destination points at, and what the delivery must depend on. */
interface DeliveryTarget {
  resourceArn: string;
  /**
   * The destination's constructs, not just their policies. The delivery then
   * waits for the grant on create, and on delete it goes first: before an
   * `autoDeleteObjects` custom resource empties the bucket, which would
   * otherwise race the delivery still writing to it.
   */
  dependencies: IDependable[];
  /** Set when the builder created the bucket. */
  bucket?: Bucket;
}

type SourceConditions = Record<string, Record<string, string>>;

function logGroupTarget(
  scope: IConstruct,
  logGroup: ILogGroup,
  conditions: SourceConditions,
): DeliveryTarget {
  warnIfNotUsEast1(scope, logGroup);
  logGroup.addToResourcePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal(LOG_DELIVERY_PRINCIPAL)],
      actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
      resources: [logGroup.logGroupArn],
      conditions,
    }),
  );
  return {
    resourceArn: logGroup.logGroupArn,
    // The log group's resource policy is one of its children.
    dependencies: [logGroup],
  };
}

function s3Target(
  scope: IConstruct,
  { bucket: userBucket, prefix, configure }: StandardLoggingS3Destination["s3"],
  hiveCompatiblePaths: boolean | undefined,
  conditions: SourceConditions,
  context: Record<string, object>,
): DeliveryTarget {
  let bucket: Bucket | undefined;
  let target: IBucket;
  if (userBucket === undefined) {
    // Set explicitly, though it is S3's default, so the template shows it.
    let sub = accessLogBucketBuilder(ObjectOwnership.BUCKET_OWNER_ENFORCED);
    if (configure) sub = configure(sub);
    // Pass the build context down, so `configure` can hand the sub-builder a
    // `ref()` to a sibling, such as a KMS key.
    bucket = sub.build(scope, "Bucket", context).bucket;
    target = bucket;
  } else {
    target = resolve(userBucket, context);
  }
  errorIfBucketNameHasDots(target);

  const keyPrefix = prefix?.replace(/^\/+|\/+$/g, "");
  // With no prefix CloudFront writes under its own default path, which
  // Hive-compatible paths render as `aws-account-id=<id>`.
  const objectKeys = keyPrefix
    ? `${keyPrefix}/*`
    : `AWSLogs/${hiveCompatiblePaths ? "aws-account-id=" : ""}${Aws.ACCOUNT_ID}/CloudFront/*`;

  // The bucket policy, and any auto-delete custom resource, are its children.
  const dependencies: IDependable[] = [target];
  // Written into the template on purpose: without it, CloudWatch Logs
  // appends the statement to the bucket policy itself, out of band, and the
  // next deploy of the CDK-managed policy silently removes it again.
  target.addToResourcePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal(LOG_DELIVERY_PRINCIPAL)],
      actions: ["s3:PutObject"],
      resources: [target.arnForObjects(objectKeys)],
      conditions: {
        ...conditions,
        StringEquals: {
          ...conditions.StringEquals,
          "s3:x-amz-acl": "bucket-owner-full-control",
        },
      },
    }),
  );

  if (target.encryptionKey) {
    const { statementAdded } = target.encryptionKey.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal(LOG_DELIVERY_PRINCIPAL)],
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
        ],
        resources: ["*"],
        conditions,
      }),
    );
    // A key's policy lives on the key itself.
    if (statementAdded) dependencies.push(target.encryptionKey);
  }

  return {
    resourceArn: keyPrefix ? `${target.bucketArn}/${keyPrefix}` : target.bucketArn,
    dependencies,
    bucket,
  };
}

function overrideIfSet(resource: CfnResource, property: string, value: unknown): void {
  if (value !== undefined) resource.addPropertyOverride(property, value);
}

function validate(
  config: Partial<CloudFrontLogDeliveryBuilderProps>,
  destination: StandardLoggingDestination,
): void {
  if ("deliveryDestinationArn" in destination && config.outputFormat !== undefined) {
    throw new Error(
      "standard logging (v2): 'outputFormat' cannot be combined with 'deliveryDestinationArn' — " +
        "the output format belongs to the delivery destination, which you manage.",
    );
  }
  if ("logGroup" in destination && config.s3EnableHiveCompatiblePath !== undefined) {
    throw new Error(
      "standard logging (v2): 's3EnableHiveCompatiblePath' applies only to an S3 destination.",
    );
  }
  if ("s3" in destination && destination.s3.bucket && destination.s3.configure) {
    throw new Error(
      "standard logging (v2): 's3.configure' cannot be combined with 's3.bucket' — " +
        "the bucket is user-managed and not built by this builder.",
    );
  }
}

function errorIfBucketNameHasDots(bucket: IBucket): void {
  const name = bucket.bucketName;
  if (Token.isUnresolved(name) || /^[\w-]+$/.test(name)) return;
  throw new Error(
    `standard logging (v2): bucket "${name}" cannot receive CloudFront standard logs — ` +
      `vended-log delivery accepts only bucket names matching [\\w-] (no dots).`,
  );
}

function errorIfStackNotUsEast1(scope: IConstruct): void {
  const stackRegion = Stack.of(scope).region;
  // Env-agnostic stacks have no concrete region at synth, so fall back to
  // CDK_DEFAULT_REGION, the variable the CDK toolkit fills the deploy region
  // from. Unset, the region can't be checked, so warn instead.
  const region = Token.isUnresolved(stackRegion) ? process.env.CDK_DEFAULT_REGION : stackRegion;
  if (!region) {
    Annotations.of(scope).addWarningV2(
      REGION_WARNING_ID,
      `CloudFront standard logging (v2) creates its delivery source in this stack, and ` +
        `CloudWatch Logs accepts it only in ${DELIVERY_REGION}. This stack is env-agnostic and ` +
        `CDK_DEFAULT_REGION is not set, so the deploy region cannot be checked at synth time. ` +
        `Pin env: { region: '${DELIVERY_REGION}' } on the stack to silence this warning.`,
    );
    return;
  }
  if (region !== DELIVERY_REGION) throw new Error(regionErrorMessage(region));
}

function regionErrorMessage(region: string): string {
  return (
    `CloudFront standard logging (v2) must be set up in ${DELIVERY_REGION}, but this stack is ` +
    `deployed in "${region}". The delivery source is created next to the distribution, so ` +
    `either:\n` +
    `  1. Deploy the stack containing this distribution in ${DELIVERY_REGION}, or\n` +
    `  2. Use legacy logging: accessLogs({ prefix: "logs/" }), or\n` +
    `  3. Set accessLogs(false) to opt out.`
  );
}

function warnIfNotUsEast1(scope: IConstruct, logGroup: ILogGroup): void {
  const region = logGroup.env.region;
  if (Token.isUnresolved(region) || region === DELIVERY_REGION) return;
  Annotations.of(scope).addWarningV2(
    REGION_WARNING_ID,
    `standard logging (v2) delivers to a log group in "${region}", but CloudFront documents ` +
      `cross-region delivery for S3 destinations only. Use a log group in ${DELIVERY_REGION}.`,
  );
}
