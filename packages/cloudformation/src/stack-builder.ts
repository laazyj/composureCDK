import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { type Lifecycle, type ScopeFactory } from "@composurecdk/core";
import { getBuilderTags, type ITaggedBuilder, taggedBuilder } from "./tagged-builder.js";

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
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a Stack with the configured properties and returns a
 * {@link StackBuilderResult}.
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

  /**
   * Returns a {@link ScopeFactory} that creates Stacks with the builder's
   * configured properties — including any tags accumulated via
   * {@link ITaggedBuilder.tag | .tag()}. Use this to integrate with
   * {@link singleStack} or {@link groupedStacks} strategies.
   *
   * Each call captures a snapshot of the current props and tags; subsequent
   * builder mutations do not affect previously returned factories.
   *
   * @returns A factory function compatible with stack strategies.
   *
   * @example
   * ```ts
   * const factory = createStackBuilder()
   *   .terminationProtection(true)
   *   .tag("Owner", "platform")
   *   .toScopeFactory();
   *
   * compose({ ... }, { ... })
   *   .withStackStrategy(singleStack(factory))
   *   .build(app, "MySystem");
   * ```
   */
  toScopeFactory(): ScopeFactory {
    const props = { ...this.props };
    const tags = new Map(getBuilderTags(this));
    return (scope: IConstruct, id: string) => {
      const stack = new Stack(scope, id, props);
      for (const [key, value] of tags) {
        Tags.of(stack).add(key, value);
      }
      return stack;
    };
  }

  build(scope: IConstruct, id: string): StackBuilderResult {
    return { stack: new Stack(scope, id, this.props) };
  }
}

/**
 * Creates a new {@link IStackBuilder} for configuring a CloudFormation Stack.
 *
 * This is the entry point for declarative stack configuration. The returned
 * builder exposes every {@link StackProps} property as a fluent setter/getter,
 * `.tag(key, value)` / `.tags({...})` for stack-level tagging, and
 * {@link IStackBuilder.toScopeFactory | .toScopeFactory()} for integration
 * with stack strategies.
 *
 * @returns A fluent builder for a CloudFormation Stack.
 *
 * @example
 * ```ts
 * // Build a stack directly
 * const { stack } = createStackBuilder()
 *   .description("Service layer")
 *   .terminationProtection(true)
 *   .build(app, "ServiceStack");
 *
 * // Use as a scope factory with strategies
 * const factory = createStackBuilder()
 *   .terminationProtection(true)
 *   .tag("team", "platform")
 *   .toScopeFactory();
 *
 * compose({ ... }, { ... })
 *   .withStackStrategy(singleStack(factory))
 *   .build(app, "MySystem");
 * ```
 */
export function createStackBuilder(): IStackBuilder {
  return taggedBuilder<StackProps, StackBuilder>(StackBuilder);
}
