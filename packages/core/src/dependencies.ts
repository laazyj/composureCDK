import { Construct, type IConstruct } from "constructs";
import { resolve, type Ref } from "./ref.js";

/**
 * A source of ordering for {@link addDependencies}: a construct, a {@link Ref}
 * to one construct inside a sibling's result (`ref("api", (r) => r.api)`), or a
 * {@link Ref} to the **whole** sibling (`ref("api")`), which reaches every
 * construct that component built.
 *
 * The two ref shapes differ in reach. A construct-level dependency already
 * covers that construct's own children — ordering against a `RestApi` also
 * orders against its deployment and stage — so naming one is enough whenever
 * what you need sits under it. Naming the component instead also picks up its
 * *peers*: an API's access log group, a queue's dead-letter queue, and any
 * construct the component was passed.
 *
 * Builders exposing a dependency option point here rather than restating it.
 * The core README's "What `sources` accepts" section mirrors it for readers.
 */
export type DependencySource = IConstruct | Ref<object>;

/**
 * Orders `target` after everything reachable through `sources`, resolved
 * against the build context.
 *
 * `compose()` decides the order components *build*; CloudFormation decides the
 * order resources *deploy*, and it only orders B after A when B's template
 * references A. A `ref()`-wired dependency usually produces such a reference
 * on its own. This is for the residual case where it does not — an SDK call
 * whose parameters are hardcoded strings, a function invoked for its effect
 * rather than its return value — where the dependency has to be declared outright.
 *
 * This is for builder authors: a builder calls it from its own `build()`, with
 * the context it was given, for a construct it creates. It backs `dependsOn()`
 * in this package, the custom-resources builder's `.dependsOn()`, and `after`
 * on lambda's `.invokeOnDeploy()`. An app author ordering a component inside
 * `compose()` uses `dependsOn()` instead.
 */
export function addDependencies(
  target: IConstruct,
  sources: readonly DependencySource[],
  context: Record<string, object>,
): void {
  const constructs = new Set<IConstruct>();
  const seen = new WeakSet();
  for (const source of sources) {
    collectConstructs(resolve(source, context), constructs, seen);
  }
  for (const construct of constructs) {
    target.node.addDependency(construct);
  }
}

/**
 * Recursively collects the constructs reachable from a resolved component
 * result. A `compose()` component's result is a plain record whose values are
 * constructs (`{ bucket }`), or nested maps of constructs (`{ alarms: {...} }`),
 * so the walk descends into plain objects and arrays but **stops at the first
 * construct** — its descendants are ordered transitively by CloudFormation, and
 * descending into a construct's own `node` tree would pull in unrelated nodes.
 *
 * Note this is a *wider* traversal than `applyBuilderTags`' walk in
 * `@composurecdk/cloudformation`, which deliberately skips arrays. The two are
 * not interchangeable: ordering against a construct held in an array is
 * harmless, tagging one that way is a visible change.
 *
 * @param value - The value to search (typically a component's build result).
 * @param out - Accumulates the constructs found.
 * @param seen - Guards against cycles in plain-object graphs.
 * @internal — exported for unit testing; not part of the public API.
 */
export function collectConstructs(
  value: unknown,
  out: Set<IConstruct>,
  seen: WeakSet<object>,
): void {
  if (value === null || typeof value !== "object") return;
  if (Construct.isConstruct(value)) {
    out.add(value);
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    collectConstructs(entry, out, seen);
  }
}
