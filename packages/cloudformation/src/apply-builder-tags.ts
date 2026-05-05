import { Tags } from "aws-cdk-lib";
import { Construct, type IConstruct } from "constructs";

function isConstruct(value: unknown): value is IConstruct {
  return value !== null && typeof value === "object" && Construct.isConstruct(value);
}

/**
 * Applies every accumulated tag to every {@link IConstruct} reachable in a
 * builder result, one level deep.
 *
 * The walker tags:
 * - any top-level field whose value is an `IConstruct`, and
 * - any value inside top-level fields whose value is a plain object treated
 *   as `Record<string, IConstruct>` — alarms maps, topic-policy maps, and
 *   similar collections produced by builders that create multiple
 *   homogeneous resources.
 *
 * Plain-data fields, CDK core objects that are not constructs (e.g.
 * `PolicyDocument`), and arrays are skipped. Recursion deeper than one level
 * is intentionally not performed — wrapper objects (e.g. `FunctionEntry`)
 * are not unwrapped automatically and need to expose their construct as a
 * top-level result field if they want to be tagged by this walker.
 *
 * Matches `Tags.of(scope).add` semantics: the call schedules an Aspect that
 * walks the construct subtree at synth-prepare time, so children of each
 * tagged construct also receive the tag.
 */
export function applyBuilderTags(result: object, tags: ReadonlyMap<string, string>): void {
  if (tags.size === 0) return;

  for (const value of Object.values(result)) {
    if (isConstruct(value)) {
      applyTagsToConstruct(value, tags);
      continue;
    }
    if (isPlainObject(value)) {
      for (const inner of Object.values(value)) {
        if (isConstruct(inner)) {
          applyTagsToConstruct(inner, tags);
        }
      }
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
