import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import {
  type IStreamConsumer,
  StreamConsumer,
  type StreamConsumerProps,
} from "aws-cdk-lib/aws-kinesis";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { StreamConsumerAlarmConfig } from "./stream-consumer-alarm-config.js";
import { createStreamConsumerAlarms } from "./stream-consumer-alarms.js";
import { validateStreamConsumerName } from "./stream-name.js";

/**
 * Configuration properties for the Kinesis stream consumer builder.
 *
 * Extends the CDK {@link StreamConsumerProps} with additional builder-specific
 * options. `streamConsumerName` and `stream` are both required at build.
 */
export interface StreamConsumerBuilderProps extends Omit<StreamConsumerProps, "stream"> {
  /**
   * The Kinesis data stream to register the consumer with. Required.
   *
   * Accepts a concrete stream or a {@link Resolvable} — typically a
   * {@link Ref} to a composed {@link createStreamBuilder} component, so the
   * consumer is wired into the `compose` graph.
   *
   * The inner type is read from CDK's own prop rather than named as `IStream`,
   * so it tracks the consumer's installed `aws-cdk-lib` (ADR-0018).
   */
  stream: Resolvable<StreamConsumerProps["stream"]>;

  /**
   * Configuration for AWS-recommended CloudWatch alarms. Set to `false` to
   * disable the recommended alarms; custom alarms added via `addAlarm()` are
   * still created.
   *
   * No alarm actions are configured by default since notification methods are
   * user-specific. Access alarms from the build result or use an `afterBuild`
   * hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  recommendedAlarms?: StreamConsumerAlarmConfig | false;
}

/**
 * The build output of a {@link IStreamConsumerBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface StreamConsumerBuilderResult {
  /** The Kinesis enhanced fan-out stream consumer created by the builder. */
  consumer: StreamConsumer;

  /**
   * CloudWatch alarms created for the consumer, keyed by alarm name. Includes
   * any custom alarms added via {@link IStreamConsumerBuilder.addAlarm}.
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an Amazon Kinesis enhanced
 * fan-out stream consumer.
 *
 * Each configuration property from the CDK {@link StreamConsumerProps} is
 * exposed as an overloaded method: call with a value to set it (returns the
 * builder for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it registers
 * the consumer with its stream and returns a
 * {@link StreamConsumerBuilderResult}.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kinesis.StreamConsumer.html
 * @see https://docs.aws.amazon.com/streams/latest/dev/enhanced-consumers.html
 */
export type IStreamConsumerBuilder = ITaggedBuilder<
  StreamConsumerBuilderProps,
  StreamConsumerBuilder
>;

class StreamConsumerBuilder implements Lifecycle<StreamConsumerBuilderResult> {
  props: Partial<StreamConsumerBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IStreamConsumer>[] = [];

  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<IStreamConsumer>,
    ) => AlarmDefinitionBuilder<IStreamConsumer>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IStreamConsumer>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: StreamConsumerBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): StreamConsumerBuilderResult {
    const { recommendedAlarms, stream, streamConsumerName, ...configured } = this.props;

    if (stream === undefined || !streamConsumerName) {
      throw new Error(
        `StreamConsumerBuilder "${id}" requires a stream and a streamConsumerName. ` +
          `Call .stream() and .streamConsumerName().`,
      );
    }

    // Fail at synth, at the authoring call site, instead of at deploy time.
    // The validator skips unresolved tokens (ADR-0010).
    validateStreamConsumerName(streamConsumerName);

    const consumer = new StreamConsumer(scope, id, {
      ...configured,
      streamConsumerName,
      stream: resolve(stream, context),
    });

    const alarms = createStreamConsumerAlarms(
      scope,
      id,
      consumer,
      recommendedAlarms,
      this.#customAlarms,
    );

    return { consumer, alarms };
  }
}

/**
 * Creates a new {@link IStreamConsumerBuilder} for configuring an Amazon
 * Kinesis enhanced fan-out stream consumer.
 *
 * An enhanced fan-out consumer gets its own 2 MB/s of read throughput per
 * shard, pushed over HTTP/2, rather than sharing the stream's read throughput
 * with every other consumer. Use it for several parallel consumers of one
 * stream, or for sub-200 ms propagation delay.
 *
 * @returns A fluent builder for an Amazon Kinesis enhanced fan-out consumer.
 *
 * @example
 * ```ts
 * const system = compose(
 *   {
 *     telemetry: createStreamBuilder().streamName("telemetry"),
 *     alerter: createStreamConsumerBuilder()
 *       .streamConsumerName("anomaly-alerter")
 *       .stream(ref<StreamBuilderResult>("telemetry").get("stream")),
 *   },
 *   { telemetry: [], alerter: ["telemetry"] },
 * );
 * ```
 */
export function createStreamConsumerBuilder(): IStreamConsumerBuilder {
  return taggedBuilder<StreamConsumerBuilderProps, StreamConsumerBuilder>(StreamConsumerBuilder);
}
