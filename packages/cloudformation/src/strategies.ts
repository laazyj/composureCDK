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
 * The Stack is created lazily on the first call to `resolve` and reused
 * for all subsequent components. The supplied `builder` is invoked at that
 * point as `builder.build(scope, id).stack`, so any tags applied via the
 * builder's `.tag()` method land on the resulting Stack.
 *
 * The builder's `build()` is called lazily. If the original may be mutated
 * after this call, pass `builder.copy()` to snapshot the configuration.
 *
 * @param builder - Optional builder for configuring the Stack. Defaults to
 *   a fresh {@link createStackBuilder} per call, producing a plain Stack
 *   with no extra configuration. For non-Stack scope types, use
 *   `singleStack` from `@composurecdk/core` directly with a `ScopeFactory`.
 * @returns A {@link StackStrategy} that groups all components into one Stack.
 *
 * @example
 * ```ts
 * compose({ handler, api }, { handler: [], api: ["handler"] })
 *   .withStackStrategy(singleStack())
 *   .build(app, "MySystem");
 *
 * // With a configured builder:
 * const base = createStackBuilder().tag("team", "platform");
 * compose({ ... }, { ... })
 *   .withStackStrategy(singleStack(base.copy()))
 *   .build(app, "MySystem");
 * ```
 */
export function singleStack(builder?: Lifecycle<StackBuilderResult>): StackStrategy {
  const stackBuilder = builder ?? createStackBuilder();
  return coreSingleStack((scope, id) => stackBuilder.build(scope, id).stack);
}

/**
 * Creates a strategy that groups components into named Stacks determined by
 * a classifier function.
 *
 * Components that return the same group key share a Stack. Stacks are
 * created lazily as new group keys are encountered. The supplied `builder`
 * is invoked once per group as `builder.build(scope, id).stack` with
 * `id = ${systemId}-${group}`, so any configured tags propagate to every
 * Stack the strategy creates.
 *
 * The builder's `build()` is called lazily. If the original may be mutated
 * after this call, pass `builder.copy()` to snapshot the configuration.
 *
 * @param classify - A function that maps a component key to a group name.
 * @param builder - Optional builder for configuring each Stack. Defaults to
 *   a fresh {@link createStackBuilder} per call. For non-Stack scope types,
 *   use `groupedStacks` from `@composurecdk/core` directly with a
 *   `ScopeFactory`.
 * @returns A {@link StackStrategy} that groups components by classifier output.
 *
 * @example
 * ```ts
 * compose({ handler, api, table }, { ... })
 *   .withStackStrategy(groupedStacks(key => key === "table" ? "persistence" : "service"))
 *   .build(app, "MySystem");
 *
 * // With a configured builder, snapshotted via .copy():
 * const base = createStackBuilder().tag("team", "platform");
 * compose({ ... }, { ... })
 *   .withStackStrategy(
 *     groupedStacks(key => key === "table" ? "persistence" : "service", base.copy()),
 *   )
 *   .build(app, "MySystem");
 * ```
 */
export function groupedStacks(
  classify: (componentKey: string) => string,
  builder?: Lifecycle<StackBuilderResult>,
): StackStrategy {
  const stackBuilder = builder ?? createStackBuilder();
  return coreGroupedStacks(classify, (scope, id) => stackBuilder.build(scope, id).stack);
}
