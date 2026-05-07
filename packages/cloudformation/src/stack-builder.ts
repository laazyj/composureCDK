import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { Builder, COPY_STATE, type IBuilder, type Lifecycle } from "@composurecdk/core";

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
 * @example
 * ```ts
 * const { stack } = createStackBuilder()
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
};

class StackBuilder implements Lifecycle<StackBuilderResult> {
  props: Partial<StackProps> = {};
  readonly #tags: [string, string][] = [];

  tag(key: string, value: string): this {
    this.#tags.push([key, value]);
    return this;
  }

  [COPY_STATE](next: StackBuilder): void {
    next.#tags.push(...this.#tags);
  }

  build(scope: IConstruct, id: string): StackBuilderResult {
    const stack = new Stack(scope, id, this.props);
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
 * plus {@link IStackBuilder.tag | .tag()} for adding tags. It implements
 * {@link Lifecycle}, so it composes naturally and can be passed to
 * {@link singleStack} or {@link groupedStacks}.
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
  return Builder<StackProps, StackBuilder>(StackBuilder);
}
