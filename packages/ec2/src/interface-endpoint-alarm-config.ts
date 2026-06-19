import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a VPC interface endpoint.
 * All alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#PrivateLinkEndpoints
 */
export interface InterfaceEndpointAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the endpoint drops packets, indicating the endpoint or
   * endpoint service is unhealthy, a security group is blocking traffic,
   * or packets are hitting the 8,500-byte PrivateLink MTU limit.
   *
   * Metric: `AWS/PrivateLinkEndpoints PacketsDropped`, statistic Sum,
   * period 1 minute. Default threshold: > 0 over 5 consecutive 1-minute
   * windows.
   *
   * If your workload intentionally sends packets larger than 8,500 bytes
   * you may want to raise the threshold to reduce noise from expected MTU
   * drops.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#PrivateLinkEndpoints
   */
  packetsDropped?: AlarmConfig | false;
}
