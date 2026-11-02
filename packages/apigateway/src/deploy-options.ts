import {
  AccessLogFormat,
  type IAccessLogDestination,
  type StageOptions,
} from "aws-cdk-lib/aws-apigateway";
import { ArnFormat } from "aws-cdk-lib";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { createLogGroupBuilder } from "@composurecdk/logs";

interface AccessLoggingResult {
  accessLogGroup?: LogGroup;
  deployOptions: StageOptions;
}

/**
 * An access log destination whose ARN has no trailing `:*`. API Gateway stores
 * the ARN without it, so CDK's `LogGroupLogDestination` makes CloudFormation
 * report the stage as drifted unless the app sets
 * `@aws-cdk/aws-apigateway:logGroupDestinationArnWithoutWildcard`. This renders
 * what that flag renders, without depending on the app's context.
 */
function accessLogDestinationFor(logGroup: LogGroup): IAccessLogDestination {
  return {
    bind: () => ({
      destinationArn: logGroup.stack.formatArn({
        service: "logs",
        resource: "log-group",
        resourceName: logGroup.logGroupName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
    }),
  };
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
  context?: Record<string, object>,
): AccessLoggingResult {
  const autoAccessLog = (accessLogging ?? true) && !userDeployOptions.accessLogDestination;

  let accessLogGroup: LogGroup | undefined;
  let accessLogProps = {};

  if (autoAccessLog) {
    // Forward the build context even though this sub-builder is currently
    // seeded with no user input: `accessLogging` is a boolean, so there is no
    // `configure` hook through which a caller could hand it a `ref()` today.
    // Threading it now means the call site does not silently become the
    // "component not found in context" bug the moment such a hook is added.
    accessLogGroup = createLogGroupBuilder().build(scope, `${id}AccessLogs`, context).logGroup;
    accessLogProps = {
      accessLogDestination: accessLogDestinationFor(accessLogGroup),
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
