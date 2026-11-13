import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type PolicyStatement } from "aws-cdk-lib/aws-iam";
import { type IStream, Stream, StreamEncryption, type StreamProps } from "aws-cdk-lib/aws-kinesis";
import { type IKey } from "aws-cdk-lib/aws-kms";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { type AlarmConfigurer, AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { STREAM_DEFAULTS } from "./defaults.js";
import type { StreamAlarmConfig } from "./stream-alarm-config.js";
import { createStreamAlarms } from "./stream-alarms.js";
import { validateStreamName } from "./stream-name.js";

/**
 * A statement for {@link IStreamBuilder.addToResourcePolicy}: a
 * {@link PolicyStatement}, a {@link Resolvable} of one, or a function of the
 * built stream that returns either — so the statement can name the stream's
 * own ARN.
 */
export type StreamPolicyStatement =
  Resolvable<PolicyStatement> | ((stream: IStream) => Resolvable<PolicyStatement>);

/**
 * Configuration properties for the Kinesis data stream builder.
 *
 * Extends the CDK {@link StreamProps} with additional builder-specific options.
 */
export interface StreamBuilderProps extends Omit<StreamProps, "encryptionKey"> {
  /**
   * The customer-managed KMS key used for server-side encryption of records
   * at rest.
   *
   * Accepts a concrete key or a {@link Resolvable} — typically a {@link Ref}
   * to a composed `@composurecdk/kms` key builder, so the key is a component
   * of the system rather than a construct built outside it.
   *
   * Supplying a key switches `encryption` from the `MANAGED` default to
   * `StreamEncryption.KMS` (ADR-0009). An explicit `encryption` still wins.
   *
   * The inner type is read from CDK's own prop rather than named as `IKey`, so
   * it tracks the `kms.IKey` → `kms.IKeyRef` migration in either direction
   * (ADR-0018) — see the table in `@composurecdk/kms`'s README.
   */
  encryptionKey?: Resolvable<NonNullable<StreamProps["encryptionKey"]>>;

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates the recommended alarms in
   * {@link STREAM_ALARM_DEFAULTS}, with the iterator-age threshold derived
   * from the stream's `retentionPeriod`. Individual alarms can be customized
   * or disabled. Set to `false` to disable the recommended alarms; custom
   * alarms added via `addAlarm()` are still created.
   *
   * No alarm actions are configured by default since notification methods are
   * user-specific. Access alarms from the build result or use an `afterBuild`
   * hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  recommendedAlarms?: StreamAlarmConfig | false;
}

/**
 * The build output of a {@link IStreamBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface StreamBuilderResult {
  /** The Kinesis data stream construct created by the builder. */
  stream: Stream;

  /**
   * CloudWatch alarms created for the stream, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added via
   * {@link IStreamBuilder.addAlarm}. Access individual alarms by key (e.g.,
   * `result.alarms.getRecordsIteratorAgeMilliseconds`); see
   * {@link StreamAlarmConfig} for the recommended keys.
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   */
  alarms: Record<string, Alarm>;

  /**
   * The stream's customer-managed encryption key: the one supplied through
   * `encryptionKey`, or the one CDK creates for `encryption:
   * StreamEncryption.KMS` without a key.
   *
   * `undefined` when the stream uses the AWS-managed key (the default) or is
   * unencrypted.
   */
  key?: IKey;
}

/**
 * A fluent builder for configuring and creating an Amazon Kinesis data stream.
 *
 * Each configuration property from the CDK {@link StreamProps} is exposed as
 * an overloaded method: call with a value to set it (returns the builder for
 * chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates a
 * stream with the configured properties and returns a
 * {@link StreamBuilderResult}.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kinesis.Stream.html
 *
 * @example
 * ```ts
 * const telemetry = createStreamBuilder().streamName("telemetry");
 * ```
 */
export type IStreamBuilder = ITaggedBuilder<StreamBuilderProps, StreamBuilder>;

class StreamBuilder implements Lifecycle<StreamBuilderResult> {
  props: Partial<StreamBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IStream>[] = [];
  readonly #policyStatements: StreamPolicyStatement[] = [];

  addAlarm(key: string, configure: AlarmConfigurer<IStream>): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IStream>(key)));
    return this;
  }

  /**
   * Adds a set of custom alarms in one call: each entry exactly as if by
   * `addAlarm(key, configure)`, in the record's iteration order.
   */
  addAlarms(alarms: Record<string, AlarmConfigurer<IStream>>): this {
    for (const [key, configure] of Object.entries(alarms)) {
      this.addAlarm(key, configure);
    }
    return this;
  }

  /**
   * Adds a statement to the stream's resource policy once the stream is
   * built.
   *
   * Pass a function of the stream to name its own ARN. A {@link Ref} resolves
   * against the build context; a component that depends on the stream cannot
   * be named that way — see the README's "Resource policy" section.
   */
  addToResourcePolicy(statement: StreamPolicyStatement): this {
    this.#policyStatements.push(statement);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: StreamBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
    target.#policyStatements.push(...this.#policyStatements);
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): StreamBuilderResult {
    const { recommendedAlarms, encryptionKey, ...configured } = this.props;

    // Fail at synth, at the authoring call site, instead of at deploy time.
    // The validator skips unresolved tokens (ADR-0010).
    if (configured.streamName !== undefined) validateStreamName(configured.streamName);

    const streamProps: StreamProps = {
      ...STREAM_DEFAULTS,
      ...configured,
      ...encryptionKeyProps(encryptionKey, configured.encryption, context),
    };
    const stream = new Stream(scope, id, streamProps);

    for (const statement of this.#policyStatements) {
      const resolvable = typeof statement === "function" ? statement(stream) : statement;
      stream.addToResourcePolicy(resolve(resolvable, context));
    }

    const alarms = createStreamAlarms(
      scope,
      id,
      stream,
      recommendedAlarms,
      streamProps.retentionPeriod,
      this.#customAlarms,
    );

    return { stream, alarms, key: stream.encryptionKey };
  }
}

/**
 * Resolves a `Resolvable` encryption key and infers the encryption mode it
 * implies.
 *
 * The `StreamEncryption.MANAGED` default is mutually exclusive with a
 * customer-managed key — CDK rejects the pair — and supplying a key is an
 * unambiguous request for SSE-KMS with that key, so the default yields
 * (ADR-0009). An explicit `encryption` still wins, and an incompatible
 * explicit pairing is left for CDK to reject.
 */
function encryptionKeyProps(
  encryptionKey: StreamBuilderProps["encryptionKey"],
  userEncryption: StreamEncryption | undefined,
  context: Record<string, object> | undefined,
): Partial<StreamProps> {
  if (encryptionKey === undefined) return {};

  return {
    encryptionKey: resolve(encryptionKey, context),
    ...(userEncryption === undefined ? { encryption: StreamEncryption.KMS } : {}),
  };
}

/**
 * Creates a new {@link IStreamBuilder} for configuring an Amazon Kinesis data
 * stream.
 *
 * This is the entry point for defining a stream component. The returned
 * builder exposes every {@link StreamBuilderProps} property as a fluent
 * setter/getter and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an Amazon Kinesis data stream.
 *
 * @example
 * ```ts
 * const system = compose(
 *   {
 *     streamKey: createKeyBuilder().description("Encrypts the telemetry stream."),
 *     telemetry: createStreamBuilder()
 *       .streamName("telemetry")
 *       .encryptionKey(ref<KeyBuilderResult>("streamKey").get("key")),
 *   },
 *   { streamKey: [], telemetry: ["streamKey"] },
 * );
 * ```
 */
export function createStreamBuilder(): IStreamBuilder {
  return taggedBuilder<StreamBuilderProps, StreamBuilder>(StreamBuilder);
}
