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
 * Applies every entry of `tags` to `target` via `Tags.of(target).add(...)`.
 * Accepts any iterable of `[key, value]` pairs so callers can pass `Map`,
 * `Object.entries(record)`, or other compatible sources without copying.
 */
export function applyTagsToConstruct(target: IConstruct, tags: Iterable<[string, string]>): void {
  const t = Tags.of(target);
  for (const [key, value] of tags) {
    t.add(key, value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
