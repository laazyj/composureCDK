import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IStream } from "aws-cdk-lib/aws-kinesis";
import type { IConstruct } from "constructs";
import { type AlarmDefinitionBuilder, createAlarms } from "@composurecdk/cloudwatch";
import type { StreamAlarmConfig } from "./stream-alarm-config.js";

/**
 * Creates the CloudWatch alarms for a Kinesis data stream: the recommended
 * alarms selected by `config`, followed by any custom alarm builders.
 *
 * The recommended set is not defined yet, so today `config` selects nothing
 * and only the custom alarms are created. It is threaded through so the set
 * lands here without a change to the builder.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param stream - The stream to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export function createStreamAlarms(
  scope: IConstruct,
  id: string,
  stream: IStream,
  config: StreamAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<IStream>[] = [],
): Record<string, Alarm> {
  const custom = customAlarms.map((b) => b.resolve(stream));
  return createAlarms(scope, id, custom);
}
