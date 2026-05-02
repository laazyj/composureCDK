import { LogGroup, type LogGroupProps } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { LOG_GROUP_DEFAULTS } from "./defaults.js";

export type LogGroupBuilderProps = LogGroupProps;

/**
 * The build output of a {@link ILogGroupBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface LogGroupBuilderResult {
  /** The CloudWatch log group construct created by the builder. */
  logGroup: LogGroup;
}

/**
 * A fluent builder for configuring and creating a CloudWatch log group.
 *
 * Each configuration property from the CDK {@link LogGroupProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a log group with the configured properties and returns a
 * {@link LogGroupBuilderResult}.
 *
 * @example
 * ```ts
 * const logs = createLogGroupBuilder()
 *   .retention(RetentionDays.SIX_MONTHS);
 * ```
 */
export type ILogGroupBuilder = IBuilder<LogGroupBuilderProps, LogGroupBuilder>;

class LogGroupBuilder implements Lifecycle<LogGroupBuilderResult> {
  props: Partial<LogGroupBuilderProps> = {};

  build(scope: IConstruct, id: string): LogGroupBuilderResult {
    const mergedProps = {
      ...LOG_GROUP_DEFAULTS,
      ...this.props,
    };
    return {
      logGroup: new LogGroup(scope, id, mergedProps),
    };
  }
}

/**
 * Creates a new {@link ILogGroupBuilder} for configuring a CloudWatch log group.
 *
 * This is the entry point for defining a log group component. The returned
 * builder exposes every {@link LogGroupProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for a CloudWatch log group.
 *
 * @example
 * ```ts
 * const logs = createLogGroupBuilder()
 *   .retention(RetentionDays.SIX_MONTHS);
 *
 * // Use standalone:
 * const result = logs.build(stack, "MyLogGroup");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { logs, api: createRestApiBuilder() },
 *   { logs: [], api: ["logs"] },
 * );
 * ```
 */
export function createLogGroupBuilder(): ILogGroupBuilder {
  return Builder<LogGroupBuilderProps, LogGroupBuilder>(LogGroupBuilder);
}
