import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type ITopic, Topic, type TopicProps } from "aws-cdk-lib/aws-sns";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { TopicAlarmConfig } from "./alarm-config.js";
import { createTopicAlarms } from "./topic-alarms.js";
import { TOPIC_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the SNS topic builder.
 *
 * Extends the CDK {@link TopicProps} with additional builder-specific options.
 */
export interface TopicBuilderProps extends TopicProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for every applicable metric. Individual alarms can be
   * customized or disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  recommendedAlarms?: TopicAlarmConfig | false;
}

/**
 * The build output of a {@link ITopicBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface TopicBuilderResult {
  /** The SNS topic construct created by the builder. */
  topic: Topic;

  /**
   * CloudWatch alarms created for the topic, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via {@link ITopicBuilder.addAlarm}. Access individual alarms
   * by key (e.g., `result.alarms.numberOfNotificationsFailed`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an AWS SNS topic.
 *
 * Each configuration property from the CDK {@link TopicProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * an SNS topic with the configured properties and returns a
 * {@link TopicBuilderResult}.
 *
 * The builder also creates AWS-recommended CloudWatch alarms by default.
 * Alarms can be customized or disabled via the `recommendedAlarms` property.
 * Custom alarms can be added via the {@link addAlarm} method.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Topic.html
 *
 * @example
 * ```ts
 * const alerts = createTopicBuilder()
 *   .topicName("my-alerts")
 *   .displayName("My Alert Topic");
 * ```
 */
export type ITopicBuilder = IBuilder<TopicBuilderProps, TopicBuilder>;

class TopicBuilder implements Lifecycle<TopicBuilderResult> {
  props: Partial<TopicBuilderProps> = {};
  private readonly customAlarms: AlarmDefinitionBuilder<ITopic>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<ITopic>) => AlarmDefinitionBuilder<ITopic>,
  ): this {
    this.customAlarms.push(configure(new AlarmDefinitionBuilder<ITopic>(key)));
    return this;
  }

  build(scope: IConstruct, id: string): TopicBuilderResult {
    const { recommendedAlarms: alarmConfig, ...topicProps } = this.props;

    const mergedProps = {
      ...TOPIC_DEFAULTS,
      ...topicProps,
    } as TopicBuilderProps;

    const topic = new Topic(scope, id, mergedProps);

    const alarms = createTopicAlarms(scope, id, topic, alarmConfig, this.customAlarms);

    return { topic, alarms };
  }
}

/**
 * Creates a new {@link ITopicBuilder} for configuring an AWS SNS topic.
 *
 * This is the entry point for defining an SNS topic component. The returned
 * builder exposes every {@link TopicBuilderProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS SNS topic.
 *
 * @example
 * ```ts
 * const alerts = createTopicBuilder()
 *   .topicName("my-alerts")
 *   .displayName("My Alert Topic");
 *
 * // Use standalone:
 * const result = alerts.build(stack, "AlertTopic");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { alerts, handler: createFunctionBuilder() },
 *   { alerts: [], handler: [] },
 * );
 * ```
 */
export function createTopicBuilder(): ITopicBuilder {
  return Builder<TopicBuilderProps, TopicBuilder>(TopicBuilder);
}
