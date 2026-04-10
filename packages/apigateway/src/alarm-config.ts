import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an API Gateway REST API.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
 */
export interface RestApiAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the API returns an elevated rate of client-side errors
   * (4XX HTTP status codes).
   *
   * Metric: `AWS/ApiGateway 4XXError`, statistic Average, period 1 minute.
   * Default threshold: > 0.05 (5% of requests).
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
   */
  clientError?: AlarmConfig | false;

  /**
   * Alarm when the API returns an elevated rate of server-side errors
   * (5XX HTTP status codes).
   *
   * Metric: `AWS/ApiGateway 5XXError`, statistic Average, period 1 minute.
   * Default threshold: > 0.05 (5% of requests).
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
   */
  serverError?: AlarmConfig | false;

  /**
   * Alarm when API latency is elevated.
   *
   * Metric: `AWS/ApiGateway Latency`, statistic p90, period 1 minute.
   * Default threshold: >= 2500ms.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
   */
  latency?: AlarmConfig | false;
}
