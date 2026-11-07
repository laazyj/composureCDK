import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import type { StreamConsumerAlarmConfig } from "./stream-consumer-alarm-config.js";

/**
 * AWS-recommended default alarm configuration for Kinesis enhanced fan-out
 * stream consumers.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export const STREAM_CONSUMER_ALARM_DEFAULTS = {
  /**
   * 60,000 ms (1 minute) behind the tip of the stream, sustained for 5
   * consecutive one-minute periods so a brief burst does not page. The right
   * value depends on the consumer's latency SLA; tune via `recommendedAlarms`.
   * Missing data is not breaching: the metric is only emitted while a
   * `SubscribeToShard` subscription is delivering events.
   */
  subscribeToShardEventMillisBehindLatest: {
    threshold: 60_000,
    evaluationPeriods: 5,
    datapointsToAlarm: 5,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
} satisfies Record<Exclude<keyof StreamConsumerAlarmConfig, "enabled">, AlarmConfigDefaults>;
