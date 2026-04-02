import { Function as LambdaFunction, type FunctionProps } from "aws-cdk-lib/aws-lambda";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { createLogGroupBuilder } from "@composurecdk/logs";
import { FUNCTION_DEFAULTS } from "./defaults.js";

export type FunctionBuilderProps = FunctionProps;

/**
 * The build output of a {@link IFunctionBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface FunctionBuilderResult {
  /** The Lambda function construct created by the builder. */
  function: LambdaFunction;

  /**
   * The CloudWatch LogGroup created for the function, or `undefined` if
   * the user provided their own via the `logGroup` property.
   *
   * By default the builder creates a managed LogGroup using
   * {@link createLogGroupBuilder} with well-architected defaults (retention
   * policy, removal policy). This follows AWS CDK guidance to create a
   * `LogGroup` explicitly rather than relying on the auto-created default,
   * which cannot be configured via CDK.
   *
   * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html
   * @see https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html
   */
  logGroup?: LogGroup;
}

/**
 * A fluent builder for configuring and creating an AWS Lambda function.
 *
 * Each configuration property from the CDK {@link FunctionProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a Lambda function with the configured properties and returns a
 * {@link FunctionBuilderResult}.
 *
 * Unless a user-supplied `logGroup` is provided, the builder automatically
 * creates a managed CloudWatch LogGroup via {@link createLogGroupBuilder}
 * with well-architected defaults (retention, removal policy) and wires it
 * to the function. This ensures full control over log lifecycle and follows
 * AWS CDK guidance to create a LogGroup explicitly.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html
 *
 * @example
 * ```ts
 * const handler = createFunctionBuilder()
 *   .runtime(Runtime.NODEJS_22_X)
 *   .handler("index.handler")
 *   .code(Code.fromAsset("lambda"))
 *   .memorySize(256)
 *   .timeout(Duration.seconds(30));
 * ```
 */
export type IFunctionBuilder = IBuilder<FunctionBuilderProps, FunctionBuilder>;

class FunctionBuilder implements Lifecycle<FunctionBuilderResult> {
  props: Partial<FunctionBuilderProps> = {};

  build(scope: IConstruct, id: string): FunctionBuilderResult {
    let logGroup: LogGroup | undefined;
    let logGroupProps = {};

    if (!this.props.logGroup) {
      logGroup = createLogGroupBuilder().build(scope, `${id}LogGroup`).logGroup;
      logGroupProps = { logGroup };
    }

    const mergedProps = {
      ...FUNCTION_DEFAULTS,
      ...logGroupProps,
      ...this.props,
    } as FunctionBuilderProps;

    return {
      function: new LambdaFunction(scope, id, mergedProps),
      logGroup,
    };
  }
}

/**
 * Creates a new {@link IFunctionBuilder} for configuring an AWS Lambda function.
 *
 * This is the entry point for defining a Lambda function component. The returned
 * builder exposes every {@link FunctionProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS Lambda function.
 *
 * @example
 * ```ts
 * const handler = createFunctionBuilder()
 *   .runtime(Runtime.NODEJS_22_X)
 *   .handler("index.handler")
 *   .code(Code.fromAsset("lambda"))
 *   .timeout(Duration.seconds(30));
 *
 * // Use standalone:
 * const result = handler.build(stack, "MyFunction");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { handler, table: createTableBuilder() },
 *   { handler: ["table"], table: [] },
 * );
 * ```
 */
export function createFunctionBuilder(): IFunctionBuilder {
  return Builder<FunctionBuilderProps, FunctionBuilder>(FunctionBuilder);
}
