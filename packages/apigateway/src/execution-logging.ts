import {
  MethodLoggingLevel,
  type RestApiBase,
  type StageOptions,
} from "aws-cdk-lib/aws-apigateway";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { createLogGroupBuilder, type ILogGroupBuilder } from "@composurecdk/logs";

/**
 * Configures the log group that the stage's CloudWatch execution logs are
 * written to. Pass `true` (or `{}`) to have the builder manage it, an object
 * to customize the log group's sub-builder, or `false` to leave the group to
 * API Gateway.
 *
 * When the stage's `loggingLevel` (or any method's, via
 * `deployOptions.methodOptions`) is anything other than `OFF`, API Gateway
 * writes to `API-Gateway-Execution-Logs_<restApiId>/<stageName>`, creating it
 * on first write when it does not exist. A group created that way never
 * expires and is not removed with the stack, so the builder creates it first
 * and makes the stage depend on it.
 *
 * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html
 */
export type ExecutionLoggingConfig =
  | boolean
  | {
      /**
       * Customize the log group sub-builder, which is pre-seeded with the
       * group's name. Keep that name: API Gateway writes execution logs only
       * to that group. The callback receives the build context, so a `ref`
       * to a sibling component (a KMS key, say) resolves.
       */
      configure?: (b: ILogGroupBuilder) => ILogGroupBuilder;
    };

function isLogging(level: MethodLoggingLevel | undefined): boolean {
  return level !== undefined && level !== MethodLoggingLevel.OFF;
}

/**
 * Creates the stage's execution log group, if any, for {@link RestApiBuilder}
 * and {@link SpecRestApiBuilder}.
 *
 * The group is named from the configured stage name rather than
 * `deploymentStage.stageName`: the latter is a reference to the stage, which
 * would make the group and the stage depend on each other.
 *
 * @internal
 */
export function resolveExecutionLogGroup(
  scope: IConstruct,
  id: string,
  api: RestApiBase,
  config: ExecutionLoggingConfig | undefined,
  deployOptions: StageOptions,
  context?: Record<string, object>,
): LogGroup | undefined {
  if (config === false) return undefined;

  const methodLevels = Object.values(deployOptions.methodOptions ?? {}).map((o) => o.loggingLevel);
  if (![deployOptions.loggingLevel, ...methodLevels].some(isLogging)) return undefined;

  const stageName = deployOptions.stageName ?? "prod";
  let subBuilder = createLogGroupBuilder().logGroupName(
    `API-Gateway-Execution-Logs_${api.restApiId}/${stageName}`,
  );
  if (typeof config === "object" && config.configure) {
    subBuilder = config.configure(subBuilder);
  }

  // Pass the build context down: `ILogGroupBuilder` widens `encryptionKey` to a
  // `Resolvable`, so a `configure` callback may hand it a `ref()` to a sibling
  // KMS key. Without the context that ref resolves against an empty record and
  // throws "component not found".
  const logGroup = subBuilder.build(scope, `${id}ExecutionLogs`, context).logGroup;
  api.deploymentStage.node.addDependency(logGroup);
  return logGroup;
}
