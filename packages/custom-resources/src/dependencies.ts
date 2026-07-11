import { Construct, type IConstruct } from "constructs";
import { type AwsCustomResource } from "aws-cdk-lib/custom-resources";
import { resolve, type Ref } from "@composurecdk/core";

/**
 * Recursively collects the constructs reachable from a resolved component
 * result. A `compose()` component's result is a plain record whose values are
 * constructs (`{ bucket }`), or nested maps of constructs (`{ alarms: {...} }`),
 * so the walk descends into plain objects and arrays but **stops at the first
 * construct** — its descendants are ordered transitively by CloudFormation, and
 * descending into a construct's own `node` tree would pull in unrelated nodes.
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

/**
 * Adds a construct dependency from the custom resource to every construct
 * reachable through the given refs, resolved against the build context. This is
 * the explicit ordering seam behind {@link IAwsCustomResourceBuilder.dependsOn}:
 * it wires a CloudFormation `DependsOn` even when the SDK call's parameters are
 * hardcoded strings (no token → no native CFN edge), and only for the
 * component(s) actually named — nothing incidental.
 *
 * @internal — not part of the public API.
 */
export function addDependenciesFromRefs(
  customResource: AwsCustomResource,
  refs: readonly Ref<object>[],
  context: Record<string, object>,
): void {
  const constructs = new Set<IConstruct>();
  const seen = new WeakSet();
  for (const ref of refs) {
    collectConstructs(resolve(ref, context), constructs, seen);
  }
  for (const construct of constructs) {
    customResource.node.addDependency(construct);
  }
}
