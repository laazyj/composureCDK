import {
  AccessLogFormat,
  LogGroupLogDestination,
  type StageOptions,
} from "aws-cdk-lib/aws-apigateway";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { createLogGroupBuilder } from "@composurecdk/logs";

interface AccessLoggingResult {
  accessLogGroup?: LogGroup;
  deployOptions: StageOptions;
}

/**
 * Resolves access logging configuration and merges deploy options with
 * the provided defaults. Shared by {@link RestApiBuilder} and
 * {@link SpecRestApiBuilder}.
 *
 * @internal
 */
export function resolveDeployOptions(
  scope: IConstruct,
  id: string,
  accessLogging: boolean | undefined,
  defaults: StageOptions,
  userDeployOptions: StageOptions,
): AccessLoggingResult {
  const autoAccessLog = (accessLogging ?? true) && !userDeployOptions.accessLogDestination;

  let accessLogGroup: LogGroup | undefined;
  let accessLogProps = {};

  if (autoAccessLog) {
    accessLogGroup = createLogGroupBuilder().build(scope, `${id}AccessLogs`).logGroup;
    accessLogProps = {
      accessLogDestination: new LogGroupLogDestination(accessLogGroup),
      accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
    };
  }

  return {
    accessLogGroup,
    deployOptions: {
      ...defaults,
      ...accessLogProps,
      ...userDeployOptions,
    },
  };
}
