import { Tags } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { type AfterBuildHook } from "@composurecdk/core";
import { validateTag } from "./tag-validator.js";

/**
 * Configures cross-cutting tag application against a composed system.
 *
 * - `system` tags reach every construct under the top-level scope passed
 *   to `build(scope, id)` — useful for ownership, environment, and cost
 *   allocation tags that should apply to every resource the system creates.
 * - `byComponent` tags reach only the scope a named component was built
 *   into. Under {@link ComposedSystem.withStacks} or
 *   {@link ComposedSystem.withStackStrategy}, components may live in
 *   different stacks — `byComponent` routes the tag to whichever scope
 *   that component received.
 *
 * Component keys in `byComponent` are statically typed against the
 * composed system's component keys, matching the pattern `outputs()` uses
 * for its `scope` field, so a typo on a component name is a compile-time
 * error.
 *
 * Builder-level tags applied via `.tag()` / `.tags()` always take
 * precedence on key conflict because they target a closer scope; CDK's
 * native tag priority resolves the collision automatically.
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
   * Tags applied only to constructs under a specific component's scope.
   * Component keys are statically checked against the composed system's
   * component keys. Each key/value pair is validated identically to
   * `system`.
   */
  byComponent?: Partial<Record<keyof T & string, Record<string, string>>>;
}

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
 * - `byComponent` entries are applied to `componentScopes[key]` —
 *   each component's own scope, which under
 *   {@link ComposedSystem.withStacks} or
 *   {@link ComposedSystem.withStackStrategy} may be a per-component
 *   stack rather than the top-level scope.
 *
 * Tag keys and values are validated synchronously inside the hook before
 * any `Tags.of(...).add(...)` call. Invalid tags throw and surface at the
 * `compose(...).afterBuild(tags({...}))` site rather than at deploy time.
 *
 * Builder-level tags (set via `.tag()` / `.tags()` on individual builders)
 * land on closer-scoped constructs and therefore win on key collision —
 * CDK's tag priority resolves the collision automatically. Use builder
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
    for (const [key, value] of Object.entries(defs.system)) {
      validateTag(key, value);
    }
  }
  const byComponent = defs.byComponent as
    | Record<string, Record<string, string> | undefined>
    | undefined;
  if (byComponent) {
    for (const componentTags of Object.values(byComponent)) {
      if (componentTags === undefined) continue;
      for (const [key, value] of Object.entries(componentTags)) {
        validateTag(key, value);
      }
    }
  }

  return (scope, _id, _results, componentScopes) => {
    if (defs.system) {
      applyTagsTo(scope, defs.system);
    }
    if (byComponent) {
      const scopesByKey = componentScopes as Readonly<Record<string, IConstruct | undefined>>;
      for (const [componentKey, componentTags] of Object.entries(byComponent)) {
        if (componentTags === undefined) continue;
        const target = scopesByKey[componentKey];
        if (target === undefined) {
          throw new Error(`tags(): byComponent entry "${componentKey}" is not a known component.`);
        }
        applyTagsTo(target, componentTags);
      }
    }
  };
}

function applyTagsTo(target: IConstruct, kv: Record<string, string>): void {
  const t = Tags.of(target);
  for (const [key, value] of Object.entries(kv)) {
    t.add(key, value);
  }
}
