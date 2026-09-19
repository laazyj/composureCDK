import { Tags } from "aws-cdk-lib";
import { Construct, type IConstruct } from "constructs";

function isConstruct(value: unknown): value is IConstruct {
  return value !== null && typeof value === "object" && Construct.isConstruct(value);
}

/**
 * Applies every accumulated tag to every {@link IConstruct} reachable in a
 * builder result.
 *
 * Recursively descends through plain-object literals, tagging every
 * `IConstruct` it finds. Stops at:
 *
 * - **Constructs** — tagged via `Tags.of(...).add(...)`. The CDK Aspect
 *   schedules tag application across the construct's subtree at
 *   synth-prepare time, so the walker does not recurse into the construct's
 *   internals.
 * - **Class instances that aren't constructs** (e.g. `PolicyDocument`) —
 *   skipped. Plain-object detection requires `Object.prototype` as the
 *   prototype, so class instances are opaque to the walker.
 * - **Arrays and primitives** — skipped.
 *
 * The contract this implements: every construct exposed in a builder's
 * result type is a tag target. Wrapper shapes such as
 * `Record<string, { construct: ..., metadata: ... }>` are unwrapped
 * naturally — the walker descends through the plain-object value and tags
 * the construct field. Authors do not need an opt-in marker; if a construct
 * appears in the result, it is tagged.
 */
export function applyBuilderTags(result: object, tags: ReadonlyMap<string, string>): void {
  if (tags.size === 0) return;
  walkAndTag(result, tags);
}

function walkAndTag(value: unknown, tags: ReadonlyMap<string, string>): void {
  if (isConstruct(value)) {
    applyTagsToConstruct(value, tags);
    return;
  }
  if (isPlainObject(value)) {
    for (const inner of Object.values(value)) {
      walkAndTag(inner, tags);
    }
  }
}

/**
 * Narrows a tag aspect to the Stack itself. `aws:cdk:stack` is the pseudo
 * resource type CDK's tag aspect uses for it. Shared across every call: CDK
 * retains the props object for the aspect's lifetime but only ever reads it.
 */
const STACK_ONLY = Object.freeze({ includeResourceTypes: ["aws:cdk:stack"] });

/**
 * Applies every entry of `tags` to `target` via `Tags.of(target).add(...)`.
 * Accepts any iterable of `[key, value]` pairs so callers can pass `Map`,
 * `Object.entries(record)`, or other compatible sources without copying.
 *
 * Every tag is applied twice, and both calls are load-bearing.
 * `@aws-cdk/core:explicitStackTags` — recommended `true` by CDK — makes
 * `Tags.of(...).add(...)` inject `excludeResourceTypes: ["aws:cdk:stack"]`, so
 * the plain call alone leaves any Stack in the target's subtree untagged while
 * the resources inside it still carry the tag. `includeResourceTypes` narrows
 * an aspect to the listed types alone, so the second call cannot stand in for
 * the first either.
 *
 * Both calls run for every target, not just a Stack. What the flag suppresses
 * is the aspect's reach over the target's *subtree*, and a target that is not
 * itself a Stack routinely contains one — `tags()` hands this the scope
 * `build()` was called with, which under a stack strategy is the `App`. On a
 * target with no Stack beneath it the second aspect is simply inert; it does
 * not reach the enclosing Stack, because an aspect only walks downwards.
 *
 * Neither call is gated on the flag's value: reading it needs
 * `cxapi.EXPLICIT_STACK_TAGS`, which does not exist at this package's
 * aws-cdk-lib floor, and re-tagging with a value already present is a no-op —
 * so paying for it always is cheaper than a floor bump.
 */
export function applyTagsToConstruct(target: IConstruct, tags: Iterable<[string, string]>): void {
  const t = Tags.of(target);
  for (const [key, value] of tags) {
    t.add(key, value);
    t.add(key, value, STACK_ONLY);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  // Accept both `{...}` literals and `Object.create(null)` dictionaries — the
  // latter is a common idiom for prototype-pollution-safe key/value maps and
  // would otherwise be silently skipped here.
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}
