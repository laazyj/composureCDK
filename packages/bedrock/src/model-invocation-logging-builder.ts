import { ArnFormat, Stack } from "aws-cdk-lib";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IRole, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { ILogGroup } from "aws-cdk-lib/aws-logs";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { type AwsCustomResource, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import type { IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { createAlarms } from "@composurecdk/cloudwatch";
import { createAwsCustomResourceBuilder } from "@composurecdk/custom-resources";
import { createRoleBuilder } from "@composurecdk/iam";
import { createLogGroupBuilder, type ILogGroupBuilder } from "@composurecdk/logs";
import {
  type ModelInvocationLoggingAlarmConfig,
  resolveModelInvocationLoggingAlarmDefinitions,
} from "./model-invocation-logging-alarms.js";

/** Which request and response modalities are logged. */
export interface ModelInvocationLoggingModalities {
  textDataDeliveryEnabled?: boolean;
  imageDataDeliveryEnabled?: boolean;
  embeddingDataDeliveryEnabled?: boolean;
  videoDataDeliveryEnabled?: boolean;
}

/** Configuration properties for {@link createModelInvocationLoggingBuilder}. */
export interface ModelInvocationLoggingBuilderProps extends ModelInvocationLoggingModalities {
  /** The log group the builder creates, from `@composurecdk/logs`' defaults. */
  logGroup?: {
    /** Customises the log group sub-builder. */
    configure?: (builder: ILogGroupBuilder) => ILogGroupBuilder;
  };

  /**
   * Receives bodies over 100 KB and binary data, such as images, which
   * CloudWatch Logs cannot hold; without it, those bodies are not logged. The
   * builder adds the bucket and key policy statements Bedrock needs to write.
   */
  largeDataBucket?: Resolvable<IBucket>;

  /** Key prefix within {@link largeDataBucket}. */
  largeDataKeyPrefix?: string;

  /**
   * Configuration for the recommended delivery-failure alarms. Set to
   * `false` to disable them.
   */
  recommendedAlarms?: ModelInvocationLoggingAlarmConfig | false;
}

/** The build output of an {@link IModelInvocationLoggingBuilder}. */
export interface ModelInvocationLoggingBuilderResult {
  /** The log group invocation logs are delivered to. */
  logGroup: ILogGroup;
  /** The role Bedrock assumes to write to {@link logGroup}. */
  role: IRole;
  /** The custom resource that applies the account's logging configuration. */
  configuration: AwsCustomResource;
  /** The CloudWatch alarms created, keyed by alarm key. */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for Amazon Bedrock model invocation logging.
 *
 * @see {@link createModelInvocationLoggingBuilder}
 */
export type IModelInvocationLoggingBuilder = ITaggedBuilder<
  ModelInvocationLoggingBuilderProps,
  ModelInvocationLoggingBuilder
>;

/**
 * Every modality is logged, so the record covers every invocation.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp04.html
 */
export const MODEL_INVOCATION_LOGGING_DEFAULTS: Required<ModelInvocationLoggingModalities> = {
  textDataDeliveryEnabled: true,
  imageDataDeliveryEnabled: true,
  embeddingDataDeliveryEnabled: true,
  videoDataDeliveryEnabled: true,
};

/** The stream Bedrock writes to within the log group. */
const LOG_STREAM = "aws/bedrock/modelinvocations";

/** Bedrock, trusted only for this account and Region (confused-deputy guard). */
function bedrockPrincipal(stack: Stack): ServicePrincipal {
  return new ServicePrincipal("bedrock.amazonaws.com", {
    conditions: {
      StringEquals: { "aws:SourceAccount": stack.account },
      ArnLike: {
        "aws:SourceArn": stack.formatArn({
          service: "bedrock",
          resource: "*",
          arnFormat: ArnFormat.NO_RESOURCE_NAME,
        }),
      },
    },
  });
}

/** Lets Bedrock write large-data objects into `bucket`. */
function grantLargeDataWrite(
  bucket: IBucket,
  bedrock: ServicePrincipal,
  keyPrefix: string | undefined,
  account: string,
): void {
  const prefix = keyPrefix ? `${keyPrefix}/` : "";
  bucket.addToResourcePolicy(
    new PolicyStatement({
      principals: [bedrock],
      actions: ["s3:PutObject"],
      resources: [bucket.arnForObjects(`${prefix}AWSLogs/${account}/BedrockModelInvocationLogs/*`)],
    }),
  );
  bucket.encryptionKey?.grant(bedrock, "kms:GenerateDataKey");
}

class ModelInvocationLoggingBuilder implements Lifecycle<ModelInvocationLoggingBuilderResult> {
  props: Partial<ModelInvocationLoggingBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): ModelInvocationLoggingBuilderResult {
    const {
      logGroup: logGroupConfig,
      largeDataBucket,
      largeDataKeyPrefix,
      recommendedAlarms,
      ...modalities
    } = this.props;
    const stack = Stack.of(scope);
    const bedrock = bedrockPrincipal(stack);

    const logGroupBuilder = createLogGroupBuilder();
    const logGroup = (logGroupConfig?.configure?.(logGroupBuilder) ?? logGroupBuilder).build(
      scope,
      `${id}LogGroup`,
      context,
    ).logGroup;

    const role = createRoleBuilder()
      .assumedBy(bedrock)
      .addInlinePolicyStatements("ModelInvocationLogsWriter", [
        new PolicyStatement({
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [
            stack.formatArn({
              service: "logs",
              resource: "log-group",
              resourceName: `${logGroup.logGroupName}:log-stream:${LOG_STREAM}`,
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
      ])
      .build(scope, `${id}Role`, context).role;

    const bucket = largeDataBucket === undefined ? undefined : resolve(largeDataBucket, context);
    if (bucket) grantLargeDataWrite(bucket, bedrock, largeDataKeyPrefix, stack.account);

    const loggingConfig = {
      cloudWatchConfig: {
        logGroupName: logGroup.logGroupName,
        roleArn: role.roleArn,
        ...(bucket && {
          largeDataDeliveryS3Config: {
            bucketName: bucket.bucketName,
            ...(largeDataKeyPrefix && { keyPrefix: largeDataKeyPrefix }),
          },
        }),
      },
      ...MODEL_INVOCATION_LOGGING_DEFAULTS,
      ...modalities,
    };

    const configurationBuilder = createAwsCustomResourceBuilder()
      .onUpdate({
        service: "Bedrock",
        action: "PutModelInvocationLoggingConfiguration",
        parameters: { loggingConfig },
        physicalResourceId: PhysicalResourceId.of("ModelInvocationLogging"),
      })
      .onDelete({ service: "Bedrock", action: "DeleteModelInvocationLoggingConfiguration" })
      // The configuration is account-wide for the Region; it has no ARN.
      .allow(
        [
          "bedrock:PutModelInvocationLoggingConfiguration",
          "bedrock:DeleteModelInvocationLoggingConfiguration",
        ],
        ["*"],
      )
      .allow(["iam:PassRole"], [role.roleArn])
      .dependsOn(role);
    if (bucket?.policy) configurationBuilder.dependsOn(bucket.policy);
    const { customResource: configuration } = configurationBuilder.build(
      scope,
      `${id}Configuration`,
      context,
    );

    const alarms = createAlarms(
      scope,
      id,
      resolveModelInvocationLoggingAlarmDefinitions(recommendedAlarms, bucket !== undefined),
    );

    return { logGroup, role, configuration, alarms };
  }
}

/**
 * Creates a builder that turns on Amazon Bedrock model invocation logging for
 * the account in the stack's Region, delivering to a log group it creates.
 *
 * Account-wide per Region: build it once. A second one overwrites the first,
 * and deleting either stack turns logging off.
 *
 * @example
 * ```ts
 * createModelInvocationLoggingBuilder()
 *   .largeDataBucket(ref("audit", (r: BucketBuilderResult) => r.bucket));
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html
 * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp04.html
 */
export function createModelInvocationLoggingBuilder(): IModelInvocationLoggingBuilder {
  return taggedBuilder<ModelInvocationLoggingBuilderProps, ModelInvocationLoggingBuilder>(
    ModelInvocationLoggingBuilder,
  );
}
