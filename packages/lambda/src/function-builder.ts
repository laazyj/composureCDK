import { Function as LambdaFunction, type FunctionProps } from "aws-cdk-lib/aws-lambda";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";

type FunctionBuilderProps = FunctionProps;

/**
 * The build output of a {@link IFunctionBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface FunctionBuilderResult {
  /** The Lambda function construct created by the builder. */
  function: LambdaFunction;
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
    return {
      function: new LambdaFunction(scope, id, this.props as FunctionBuilderProps),
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
