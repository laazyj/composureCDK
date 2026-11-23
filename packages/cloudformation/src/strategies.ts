import {
  type Lifecycle,
  type StackStrategy,
  singleStack as coreSingleStack,
  groupedStacks as coreGroupedStacks,
} from "@composurecdk/core";
import { createStackBuilder, type StackBuilderResult } from "./stack-builder.js";

/**
 * Creates a strategy that places all components in a single Stack.
 *
 * @deprecated Use `singleStack` from `@composurecdk/core`, which takes the
 * builder (or a built stack) directly: `singleStack(createStackBuilder())`.
 * This wrapper will be removed in the next minor release (ADR-0023).
 *
 * @param builder - Optional builder for the Stack. Defaults to a fresh
 *   {@link createStackBuilder}.
 * @returns A {@link StackStrategy} that groups all components into one Stack.
 */
export function singleStack(builder?: Lifecycle<StackBuilderResult>): StackStrategy {
  return coreSingleStack(builder ?? createStackBuilder());
}

/**
 * Creates a strategy that groups components into Stacks named by a classifier
 * function, each built from `builder` under `` `${systemId}-${group}` ``.
 *
 * @deprecated Use `groupedStacks` from `@composurecdk/core`, which is typed by
 * group and by component key, and takes a stack source per group so groups can
 * differ in `env` and other settings. This wrapper will be removed in the next
 * minor release (ADR-0023).
 *
 * @param classify - A function that maps a component key to a group name.
 * @param builder - Optional builder for every group's Stack. Defaults to a
 *   fresh {@link createStackBuilder}.
 * @returns A {@link StackStrategy} that groups components by classifier output.
 */
export function groupedStacks(
  classify: (componentKey: string) => string,
  builder?: Lifecycle<StackBuilderResult>,
): StackStrategy {
  const stackBuilder = builder ?? createStackBuilder();
  return {
    place: (scope, systemId, keys) => {
      const placement = Object.fromEntries(keys.map((key) => [key, classify(key)]));
      const groups = Object.fromEntries(
        Object.values(placement).map((group) => [group, stackBuilder]),
      );
      return coreGroupedStacks(groups, placement).place(scope, systemId, keys);
    },
  };
}
