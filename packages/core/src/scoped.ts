import { Construct, type IConstruct } from "constructs";
import { SCOPED_BUILD } from "./build-id.js";
import { type ComposedSystem, type ConfiguredSystem } from "./compose.js";
import { type Lifecycle } from "./lifecycle.js";

/**
 * Builds a composed system under a construct of its own, so its resources sit
 * under one node in the construct tree instead of beside their parent's.
 *
 * On `build(scope, id, context)`, `scoped` creates `new Construct(scope, id)`
 * and builds the system into it, each component at its key: a composite built
 * at `App--failures` yields `App--failures/bucket`. `at()` pins still win, and
 * `afterBuild` hooks on the system receive the new construct as their scope.
 * A component routed to another scope by `withStacks` or a strategy keeps the
 * prefixed `${id}/${key}` id, since the new construct does not namespace it.
 *
 * Wrapping an already-deployed system changes its construct paths, which
 * replaces its resources.
 *
 * @param system - A system returned by {@link compose}, optionally configured
 *   with `withStacks`, `withStackStrategy` or `afterBuild`.
 * @returns A {@link Lifecycle} that builds `system` under a construct of its own.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     orders: createTableV2Builder(),
 *     consumer: scoped(compose({ dlq, processor }, { dlq: [], processor: ["dlq"] })),
 *   },
 *   { orders: [], consumer: ["orders"] },
 * ).build(stack, "App");
 * // App--orders
 * // App--consumer/dlq
 * // App--consumer/processor
 * ```
 */
export function scoped<C extends Record<string, Lifecycle>>(
  system: ComposedSystem<C> | ConfiguredSystem<C>,
): Lifecycle<ReturnType<ComposedSystem<C>["build"]>> {
  const scopedBuild = (
    system as {
      [SCOPED_BUILD]?: (
        scope: IConstruct,
        id: string,
        context?: Record<string, object>,
      ) => ReturnType<ComposedSystem<C>["build"]>;
    }
  )[SCOPED_BUILD];
  if (typeof scopedBuild !== "function") {
    throw new TypeError("scoped() takes a system returned by compose().");
  }
  return {
    build: (scope, id, context) => scopedBuild.call(system, new Construct(scope, id), id, context),
  };
}
