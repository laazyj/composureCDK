import {
  type ScopeFactory,
  type StackStrategy,
  singleStack as coreSingleStack,
  groupedStacks as coreGroupedStacks,
} from "@composurecdk/core";
import { createStackBuilder } from "./stack-builder.js";

function defaultFactory(): ScopeFactory {
  return createStackBuilder().toScopeFactory();
}

/**
 * Creates a strategy that places all components in a single Stack.
 *
 * The Stack is created lazily on the first call to `resolve` and reused for
 * all subsequent components.
 *
 * @param factory - Optional factory for creating the Stack. Defaults to
 *   a plain CDK `Stack` via {@link createStackBuilder}.
 * @returns A {@link StackStrategy} that groups all components into one Stack.
 *
 * @example
 * ```ts
 * compose({ handler, api }, { handler: [], api: ["handler"] })
 *   .withStackStrategy(singleStack())
 *   .build(app, "MySystem");
 * ```
 */
export function singleStack(factory?: ScopeFactory): StackStrategy {
  return coreSingleStack(factory ?? defaultFactory());
}

/**
 * Creates a strategy that groups components into named Stacks determined by
 * a classifier function.
 *
 * Components that return the same group key share a Stack. Stacks are created
 * lazily as new group keys are encountered.
 *
 * @param classify - A function that maps a component key to a group name.
 * @param factory - Optional factory for creating Stacks. Defaults to
 *   a plain CDK `Stack` via {@link createStackBuilder}. The factory receives
 *   `${systemId}-${group}` as the id.
 * @returns A {@link StackStrategy} that groups components by classifier output.
 *
 * @example
 * ```ts
 * compose({ handler, api, table }, { ... })
 *   .withStackStrategy(groupedStacks(key => key === "table" ? "persistence" : "service"))
 *   .build(app, "MySystem");
 * ```
 */
export function groupedStacks(
  classify: (componentKey: string) => string,
  factory?: ScopeFactory,
): StackStrategy {
  return coreGroupedStacks(classify, factory ?? defaultFactory());
}
