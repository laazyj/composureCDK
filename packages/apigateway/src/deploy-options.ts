import {
  AccessLogFormat,
  type IAccessLogDestination,
  type StageOptions,
} from "aws-cdk-lib/aws-apigateway";
import { ArnFormat } from "aws-cdk-lib";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { createLogGroupBuilder, type ILogGroupBuilder } from "@composurecdk/logs";

/**
 * Configures the stage's access log group. Pass `true` (or `{}`) to have the
 * builder create it with the logs defaults, an object to customize the log
 * group's sub-builder, or `false` to create no access log group.
 *
 * A `deployOptions.accessLogDestination` takes precedence: the builder then
 * creates no group, and combining it with `configure` throws.
 */
export type AccessLoggingConfig =
  | boolean
  | {
      /**
       * Customize the access log group sub-builder. The callback receives the
       * build context, so a `ref` to a sibling component (a KMS key, say)
       * resolves. The stage's destination and JSON format are unaffected.
       */
      configure?: (b: ILogGroupBuilder) => ILogGroupBuilder;
    };

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
  accessLogging: AccessLoggingConfig | undefined,
  defaults: StageOptions,
  userDeployOptions: StageOptions,
  context?: Record<string, object>,
): AccessLoggingResult {
  const configure = typeof accessLogging === "object" ? accessLogging.configure : undefined;
  if (configure && userDeployOptions.accessLogDestination) {
    throw new Error(
      "accessLogging: 'configure' cannot be combined with " +
        "'deployOptions.accessLogDestination' — the destination is user-managed " +
        "and not built by this builder.",
    );
  }

  const autoAccessLog = accessLogging !== false && !userDeployOptions.accessLogDestination;

  let accessLogGroup: LogGroup | undefined;
  let accessLogProps = {};

  if (autoAccessLog) {
    let subBuilder = createLogGroupBuilder();
    if (configure) subBuilder = configure(subBuilder);
    // Pass the build context down so a `ref()` handed to the sub-builder in
    // `configure` (a sibling KMS key, say) resolves.
    accessLogGroup = subBuilder.build(scope, `${id}AccessLogs`, context).logGroup;
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
