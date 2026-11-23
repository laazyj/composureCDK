import { type IConstruct } from "constructs";
import { type AfterBuildHook } from "@composurecdk/core";
import { applyBuilderTags, applyTagsToConstruct } from "./apply-builder-tags.js";
import { validateTagRecord } from "./tag-validator.js";

/**
 * Configures cross-cutting tag application against a composed system.
 *
 * - `system` tags reach every construct under the top-level scope passed
 *   to `build(scope, id)` — useful for ownership, environment, and cost
 *   allocation tags that should apply to every resource the system creates.
 * - `byComponent` tags reach only the named component: every construct in
 *   its build result, as `.tag()` on a builder does. When the component
 *   also has its scope to itself among this system's components (its own
 *   stack under
 *   {@link ComposedSystem.withStacks} or
 *   {@link ComposedSystem.withStackStrategy}), that whole scope is tagged
 *   too, Stack included, along with anything else built into that stack.
 *   In a shared scope (the top-level scope, or a stack shared via a
 *   strategy), anything it creates but does not return is not reached;
 *   give it its own stack, or a `scoped(compose(...))` with `system` tags,
 *   if that matters.
 *
 * Component keys in `byComponent` are statically typed against the
 * composed system's component keys, matching the pattern `outputs()` uses
 * for its `scope` field, so a typo on a component name is a compile-time
 * error.
 *
 * On a key conflict a builder's own `.tag()` / `.tags()` wins over
 * `byComponent`, which wins over `system`. These tags are applied below
 * CDK's default priority, so any tag added explicitly with
 * `Tags.of(...).add(...)` at the default priority also wins over them.
 *
 * @typeParam T - The composed system's build result type. Inferred from
 * the surrounding `compose(...).afterBuild(tags(...))` chain.
 */
export interface TagDefinitions<T extends object = object> {
  /**
   * Tags applied to every construct under the top-level scope. Each
   * key/value pair is validated against the AWS tag character set; invalid
   * inputs throw at configuration time.
   */
  system?: Record<string, string>;

  /**
   * Tags applied to a named component only; see {@link TagDefinitions} for
   * how much of it they reach. Component keys are statically checked
   * against the composed system's component keys. Each key/value pair is
   * validated identically to `system`.
   */
  byComponent?: Partial<Record<keyof T & string, Record<string, string>>>;
}

/**
 * CDK tag priorities that keep the documented precedence: a builder's own
 * `.tag()` (CDK's default, 100) beats `byComponent`, which beats `system`.
 * `byComponent` tags the same constructs `.tag()` does, later in the build,
 * so at an equal priority it would win instead.
 */
const COMPONENT_TAG_PRIORITY = 99;
const SYSTEM_TAG_PRIORITY = 98;

/**
 * Returns an {@link AfterBuildHook} that applies cross-cutting tags to a
 * composed system. Modelled on {@link outputs} — both share the same
 * `(scope, id, results, componentScopes)` shape and live alongside the
 * other CloudFormation-flavoured composition helpers in this package.
 *
 * The hook walks the supplied {@link TagDefinitions} once per build:
 *
 * - `system` entries are applied to the top-level `scope` via
 *   `Tags.of(scope).add(...)`. CDK's tag aspect propagates each tag
 *   through the construct subtree to every taggable descendant.
 * - `byComponent` entries are applied to that component only (see
 *   {@link TagDefinitions}).
 *
 * Tag keys and values are validated synchronously inside the hook before
 * any `Tags.of(...).add(...)` call. Invalid tags throw and surface at the
 * `compose(...).afterBuild(tags({...}))` site rather than at deploy time.
 *
 * Builder-level tags (set via `.tag()` / `.tags()` on individual builders)
 * win on key collision (see {@link TagDefinitions}). Use builder
 * tags for selector tags that must match exactly one resource type;
 * use this helper for system-wide concerns like ownership, environment,
 * and cost-allocation dimensions.
 *
 * @param defs - System-wide and per-component tag definitions.
 * @returns An `AfterBuildHook` to pass to {@link ComposedSystem.afterBuild}.
 *
 * @example
 * ```ts
 * import { compose } from "@composurecdk/core";
 * import { tags } from "@composurecdk/cloudformation";
 *
 * compose(
 *   { agent: createInstanceBuilder(), bucket: createBucketBuilder() },
 *   { agent: [], bucket: [] },
 * )
 *   .afterBuild(
 *     tags({
 *       system: { Owner: "platform", Environment: "prod" },
 *       byComponent: { agent: { Project: "claude-rig" } },
 *     }),
 *   )
 *   .build(stack, "MySystem");
 * ```
 */
export function tags<T extends object = object>(defs: TagDefinitions<T>): AfterBuildHook<T> {
  // Validate eagerly so configuration errors surface at the call site.
  if (defs.system) {
    validateTagRecord(defs.system);
  }
  const byComponent = Object.entries(
    (defs.byComponent ?? {}) as Record<string, Record<string, string> | undefined>,
  ).flatMap(([key, componentTags]) => {
    if (componentTags === undefined) return [];
    validateTagRecord(componentTags);
    return [[key, new Map(Object.entries(componentTags))] as const];
  });

  return (scope, _id, results, componentScopes) => {
    if (defs.system) {
      applyTagsToConstruct(scope, Object.entries(defs.system), SYSTEM_TAG_PRIORITY);
    }
    const scopesByKey = componentScopes as Readonly<Record<string, IConstruct | undefined>>;
    for (const [componentKey, componentTags] of byComponent) {
      const target = scopesByKey[componentKey];
      if (target === undefined) {
        throw new Error(`tags(): byComponent entry "${componentKey}" is not a known component.`);
      }
      const ownsScope =
        target !== scope && Object.values(scopesByKey).filter((s) => s === target).length === 1;
      // What the component returned, wherever it lives (a nested system may
      // route parts to other stacks), plus its whole scope when it owns one.
      applyBuilderTags(
        (results as Record<string, object>)[componentKey],
        componentTags,
        COMPONENT_TAG_PRIORITY,
      );
      if (ownsScope) applyTagsToConstruct(target, componentTags, COMPONENT_TAG_PRIORITY);
    }
  };
}
