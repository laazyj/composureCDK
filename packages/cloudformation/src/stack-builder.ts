import { Stack, type StackProps } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "./tagged-builder.js";

/**
 * The build output of a {@link IStackBuilder}. Contains the CDK Stack
 * created during {@link Lifecycle.build}.
 */
export interface StackBuilderResult {
  /** The CDK Stack created by the builder. */
  stack: Stack;
}

/**
 * A fluent builder for configuring and creating a CloudFormation Stack.
 *
 * Each configuration property from the CDK {@link StackProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as
 * a component in a {@link compose | composed system}, or handed to a stack
 * strategy via {@link singleStack} / {@link groupedStacks}. When handing a
 * builder to a strategy that may be invoked after further configuration of
 * the original, pass `builder.copy()` to snapshot the current state.
 *
 * Tags accumulated via {@link ITaggedBuilder.tag | .tag()} or
 * {@link ITaggedBuilder.tags | .tags()} are applied to the resulting Stack.
 * CloudFormation propagates stack-level tags to every resource the stack
 * contains, so a single `.tag()` call on a stack reaches everything inside.
 *
 * @example
 * ```ts
 * const { stack } = createStackBuilder()
 *   .description("Network infrastructure")
 *   .terminationProtection(true)
 *   .tag("Owner", "platform")
 *   .build(app, "NetworkStack");
 * ```
 */
export type IStackBuilder = ITaggedBuilder<StackProps, StackBuilder>;

class StackBuilder implements Lifecycle<StackBuilderResult> {
  props: Partial<StackProps> = {};

  build(scope: IConstruct, id: string): StackBuilderResult {
    return { stack: new Stack(scope, id, this.props) };
  }
}

/**
 * Creates a new {@link IStackBuilder} for configuring a CloudFormation Stack.
 *
 * This is the entry point for declarative stack configuration. The returned
 * builder exposes every {@link StackProps} property as a fluent setter/getter,
 * `.tag(key, value)` / `.tags({...})` for stack-level tagging, and `.copy()`
 * for variant authoring. It implements {@link Lifecycle}, so it composes
 * naturally and can be passed to {@link singleStack} or
 * {@link groupedStacks}.
 *
 * @returns A fluent builder for a CloudFormation Stack.
 *
 * @example
 * ```ts
 * // Build a stack directly
 * const { stack } = createStackBuilder()
 *   .description("Service layer")
 *   .terminationProtection(true)
 *   .tag("Owner", "platform")
 *   .build(app, "ServiceStack");
 *
 * // Hand a configured builder to a strategy. Use `.copy()` to snapshot
 * // when the original may be mutated further.
 * const base = createStackBuilder()
 *   .terminationProtection(true)
 *   .tag("team", "platform");
 *
 * compose({ ... }, { ... })
 *   .withStackStrategy(singleStack(base.copy()))
 *   .build(app, "MySystem");
 * ```
 */
export function createStackBuilder(): IStackBuilder {
  return taggedBuilder<StackProps, StackBuilder>(StackBuilder);
}
