import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { RestApiBase } from "aws-cdk-lib/aws-apigateway";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import type { RestApiAlarmConfig } from "./alarm-config.js";

/**
 * Builder-specific properties shared by both {@link RestApiBuilderProps}
 * and {@link SpecRestApiBuilderProps}.
 */
export interface RestApiBuilderPropsBase {
  /**
   * Whether to automatically create a CloudWatch log group for access logging.
   *
   * When `true`, the builder creates a log group using
   * {@link createLogGroupBuilder} (with its secure defaults) and configures it
   * as the stage's access log destination with JSON-formatted output. The
   * created log group is returned in the build result as `accessLogGroup`.
   *
   * When `false`, no access log group is created. You can still provide your
   * own destination via `deployOptions.accessLogDestination`.
   *
   * This setting is ignored when `deployOptions.accessLogDestination` is
   * provided — the user-supplied destination takes precedence.
   */
  accessLogging?: boolean;

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms for client error rate,
   * server error rate, and latency. Individual alarms can be customized or
   * disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
   */
  recommendedAlarms?: RestApiAlarmConfig | false;
}

/**
 * Build result properties shared by both {@link RestApiBuilderResult}
 * and {@link SpecRestApiBuilderResult}.
 *
 * @typeParam T - The concrete REST API type (`RestApi` or `SpecRestApi`).
 */
export interface RestApiBuilderResultBase<T extends RestApiBase> {
  /** The REST API construct created by the builder. */
  api: T;

  /**
   * The CloudWatch log group created for access logging, or `undefined` if
   * access logging was disabled or the user provided their own destination.
   */
  accessLogGroup?: LogGroup;

  /**
   * CloudWatch alarms created for the API, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via `addAlarm()`. Access individual alarms by key
   * (e.g., `result.alarms.serverError`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
   */
  alarms: Record<string, Alarm>;
}
