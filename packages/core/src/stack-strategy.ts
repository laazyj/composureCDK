import { type IConstruct } from "constructs";

/**
 * A factory function that creates scopes (typically Stacks) for components.
 * Accepts any scope constructor — `Stack`, `DeploymentStack`, or custom
 * subclasses.
 *
 * @param scope - The parent scope (typically an `App`).
 * @param id - A unique identifier for the new scope.
 * @returns A new scope to attach components to.
 */
export type ScopeFactory = (scope: IConstruct, id: string) => IConstruct;

/**
 * Determines which scope a component should be built in.
 *
 * A `StackStrategy` is passed the parent scope, a system identifier,
 * and each component's key. It returns the scope that component should
 * use. Strategies can create scopes lazily, reuse them across components,
 * or delegate to a {@link ScopeFactory} for custom scope types.
 *
 * @example
 * ```ts
 * // Every component in one auto-created stack
 * compose({ handler, api }, { handler: [], api: ["handler"] })
 *   .withStackStrategy(singleStack())
 *   .build(app, "MySystem");
 *
 * // Components grouped by a key function
 * compose({ handler, api, table }, { ... })
 *   .withStackStrategy(groupedStacks(key => key === "table" ? "persistence" : "service"))
 *   .build(app, "MySystem");
 * ```
 */
export interface StackStrategy {
  /**
   * Returns the scope a component should be built in.
   *
   * @param scope - The parent scope passed to `build`.
   * @param systemId - The system identifier passed to `build`.
   * @param componentKey - The key of the component in the composed system.
   * @returns The scope to use for this component.
   */
  resolve(scope: IConstruct, systemId: string, componentKey: string): IConstruct;
}

/**
 * Creates a strategy that places all components in a single auto-created scope.
 *
 * The scope is created lazily on the first call to `resolve` and reused for
 * all subsequent components.
 *
 * @param factory - Optional factory for creating the scope. Defaults to
 *   creating a plain `Construct`.
 * @returns A {@link StackStrategy} that groups all components into one scope.
 */
export function singleStack(factory?: ScopeFactory): StackStrategy {
  return {
    resolve: (() => {
      let stack: IConstruct | undefined;
      return (scope: IConstruct, systemId: string) => {
        stack ??= factory ? factory(scope, systemId) : scope;
        return stack;
      };
    })(),
  };
}

/**
 * Creates a strategy that groups components into named scopes determined by
 * a classifier function.
 *
 * Components that return the same group key share a scope. Scopes are created
 * lazily as new group keys are encountered.
 *
 * @param classify - A function that maps a component key to a group name.
 * @param factory - Optional factory for creating scopes. Defaults to creating
 *   a plain `Construct`. The factory receives the group name as the id.
 * @returns A {@link StackStrategy} that groups components by classifier output.
 *
 * @example
 * ```ts
 * groupedStacks(
 *   key => key === "table" ? "persistence" : "service",
 *   (app, id) => new Stack(app, id),
 * )
 * ```
 */
export function groupedStacks(
  classify: (componentKey: string) => string,
  factory?: ScopeFactory,
): StackStrategy {
  const groups = new Map<string, IConstruct>();
  return {
    resolve(scope: IConstruct, systemId: string, componentKey: string): IConstruct {
      const group = classify(componentKey);
      let groupScope = groups.get(group);
      if (!groupScope) {
        groupScope = factory ? factory(scope, `${systemId}-${group}`) : scope;
        groups.set(group, groupScope);
      }
      return groupScope;
    },
  };
}
