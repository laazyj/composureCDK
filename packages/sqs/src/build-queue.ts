import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IQueue, Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { QueueAlarmProfile } from "./queue-alarm-profiles.js";
import type { QueueBuilderExtensionProps } from "./queue-props.js";
import { createQueueAlarms } from "./queue-alarms.js";

/**
 * The build output of every queue builder in this package
 * ({@link createQueueBuilder}, {@link createFifoQueueBuilder},
 * {@link createDlqQueueBuilder}). Contains the CDK constructs created
 * during {@link Lifecycle.build}, keyed by role.
 */
export interface QueueBuilderResult {
  /** The SQS queue construct created by the builder. */
  queue: Queue;

  /**
   * CloudWatch alarms created for the queue, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via `addAlarm`. Access individual alarms by key (e.g.,
   * `result.alarms.approximateAgeOfOldestMessage`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  alarms: Record<string, Alarm>;
}

/**
 * Shared build core for the queue builders: constructs the queue from
 * the already-merged, already-validated props and attaches the
 * recommended + custom alarms according to the builder's alarm profile.
 *
 * @internal
 */
export function buildQueueResult(
  scope: IConstruct,
  id: string,
  mergedProps: QueueProps & QueueBuilderExtensionProps,
  customAlarms: AlarmDefinitionBuilder<IQueue>[],
  profile: QueueAlarmProfile,
): QueueBuilderResult {
  const { recommendedAlarms, ...queueProps } = mergedProps;

  const queue = new Queue(scope, id, queueProps);
  const alarms = createQueueAlarms(scope, id, queue, recommendedAlarms, customAlarms, profile);

  return { queue, alarms };
}
