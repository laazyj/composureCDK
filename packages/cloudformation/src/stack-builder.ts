import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle, type ScopeFactory } from "@composurecdk/core";

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
 * @example
 * ```ts
 * const stack = createStackBuilder()
 *   .description("Network infrastructure")
 *   .terminationProtection(true)
 *   .build(app, "NetworkStack");
 * ```
 */
export type IStackBuilder = IBuilder<StackProps, StackBuilder> & {
  /**
   * Adds a tag to the Stack. Tags are applied to the Stack and propagate
   * to all resources within it.
   *
   * @param key - The tag key.
   * @param value - The tag value.
   * @returns The builder for chaining.
   */
  tag(key: string, value: string): IStackBuilder;

  /**
   * Returns a {@link ScopeFactory} that creates Stacks with the builder's
   * configured properties. Use this to integrate with
   * {@link singleStack} or {@link groupedStacks} strategies.
   *
   * @returns A factory function compatible with stack strategies.
   *
   * @example
   * ```ts
   * const factory = createStackBuilder()
   *   .terminationProtection(true)
   *   .toScopeFactory();
   *
   * compose({ ... }, { ... })
   *   .withStackStrategy(singleStack(factory))
   *   .build(app, "MySystem");
   * ```
   */
  toScopeFactory(): ScopeFactory;
};

class StackBuilder implements Lifecycle<StackBuilderResult> {
  props: Partial<StackProps> = {};
  readonly #tags: [string, string][] = [];

  tag(key: string, value: string): this {
    this.#tags.push([key, value]);
    return this;
  }

  toScopeFactory(): ScopeFactory {
    const props = { ...this.props };
    const tags = [...this.#tags];
    return (scope: IConstruct, id: string) => {
      const stack = new Stack(scope, id, props);
      tags.forEach(([key, value]) => {
        Tags.of(stack).add(key, value);
      });
      return stack;
    };
  }

  build(scope: IConstruct, id: string): StackBuilderResult {
    const stack = new Stack(scope, id, this.props as StackProps);
    this.#tags.forEach(([key, value]) => {
      Tags.of(stack).add(key, value);
    });
    return { stack };
  }
}

/**
 * Creates a new {@link IStackBuilder} for configuring a CloudFormation Stack.
 *
 * This is the entry point for declarative stack configuration. The returned
 * builder exposes every {@link StackProps} property as a fluent setter/getter,
 * plus {@link IStackBuilder.tag | .tag()} for adding tags and
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
  return Builder<StackProps, StackBuilder>(StackBuilder) as IStackBuilder;
}
