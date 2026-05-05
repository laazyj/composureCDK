import { Builder } from "@composurecdk/core";
import { applyBuilderTags } from "./apply-builder-tags.js";
import { validateTag, validateTagRecord } from "./tag-validator.js";

type Constructor<T> = new () => T;

interface ObjectWithProps<Props extends object> {
  props: Partial<Props>;
}

/**
 * A fluent builder extended with tag-accumulating methods. Returned by
 * {@link taggedBuilder}.
 *
 * Mirrors `IBuilder<Props, T>` from `@composurecdk/core` but rewrites every
 * chainable return type to `ITaggedBuilder<Props, T>` so the augmenting
 * `.tag()` / `.tags()` methods stay reachable after any prop setter or
 * chainable method on `T`.
 *
 * Tags accumulated via {@link ITaggedBuilder.tag | .tag()} and
 * {@link ITaggedBuilder.tags | .tags()} are applied to every construct in
 * the build result one level deep — see
 * {@link applyBuilderTags} for the exact walk.
 *
 * @typeParam Props - The configurable properties.
 * @typeParam T - The target class the builder wraps.
 */
export type ITaggedBuilder<Props extends object, T> = {
  [K in keyof Props]-?: ((arg: Props[K]) => ITaggedBuilder<Props, T>) & (() => Props[K]);
} & {
  [K in keyof T]: T[K] extends (...args: infer A) => T
    ? (...args: A) => ITaggedBuilder<Props, T>
    : T[K];
} & {
  /**
   * Adds a single tag. Validates the key/value at call time and throws on
   * AWS-rejected inputs (empty key, `aws:` prefix, oversize, disallowed
   * characters).
   *
   * Repeated keys overwrite earlier values and emit a process warning so the
   * override is visible at the call site.
   *
   * @param key - The tag key.
   * @param value - The tag value.
   * @returns The builder for chaining.
   */
  tag(key: string, value: string): ITaggedBuilder<Props, T>;

  /**
   * Adds many tags at once. Each entry is validated independently as if
   * passed to {@link ITaggedBuilder.tag | .tag()}. Existing keys are
   * overwritten with a process warning.
   *
   * @param values - A record of tag keys to values.
   * @returns The builder for chaining.
   */
  tags(values: Record<string, string>): ITaggedBuilder<Props, T>;
};

/**
 * Module-private symbol used to expose the wrapper's tag accumulator to
 * builder code that creates constructs outside `build()` — currently only
 * `StackBuilder.toScopeFactory()`. Plain `Symbol(...)` (not `Symbol.for`)
 * so the registry isn't shared with unrelated code.
 */
const BUILDER_TAGS = Symbol("composurecdk.builderTags");

interface TaggedInstance {
  [BUILDER_TAGS]?: ReadonlyMap<string, string>;
}

/**
 * Reads the tag accumulator the wrapper has attached to a builder instance.
 * Returns an empty map for instances not constructed via {@link taggedBuilder}.
 *
 * The standard `build()` flow does not need this; tags are applied via the
 * walker. This getter exists for builders that produce a construct outside
 * their declared result type — currently only `StackBuilder.toScopeFactory()`.
 *
 * Returns a live, read-only view of the accumulator. Callers that want a
 * snapshot independent of later mutations should clone it (`new Map(...)`).
 */
export function getBuilderTags(instance: object): ReadonlyMap<string, string> {
  return (instance as TaggedInstance)[BUILDER_TAGS] ?? new Map();
}

/**
 * Wraps {@link Builder} to add the {@link ITaggedBuilder.tag | .tag()} and
 * {@link ITaggedBuilder.tags | .tags()} accumulators and apply the
 * collected tags to every construct in the build result one level deep.
 *
 * The wrapper maintains its own outer Proxy around the inner builder Proxy
 * created by `@composurecdk/core`. The outer Proxy:
 *
 * 1. Intercepts `.tag(k, v)` and `.tags({...})` to validate inputs and
 *    accumulate them in an insertion-ordered map. Repeated keys overwrite
 *    earlier values and emit `process.emitWarning` so the override is
 *    visible at the configuring call site.
 * 2. Intercepts `build()` to call {@link applyBuilderTags} on the result
 *    after the inner build completes.
 * 3. Passes every other access through to the inner Proxy unchanged. Inner
 *    methods that return the inner Proxy (chainable setters) are
 *    re-wrapped so the chain returns the outer Proxy and the new tag
 *    methods stay reachable.
 *
 * The accumulator is also attached to the wrapped instance via a private
 * symbol so out-of-band consumers (`StackBuilder.toScopeFactory()`) can
 * read it via {@link getBuilderTags}. The attachment happens once at
 * construction and shares the live map; the wrapper does not clone on
 * each mutation.
 *
 * Each builder factory in the library opts in by calling `taggedBuilder()`
 * instead of `Builder()`. Custom builders authored outside the library can
 * use plain `Builder()` and forgo tagging.
 *
 * @typeParam Props - The configurable properties.
 * @typeParam T - The target class the builder wraps.
 *
 * @example
 * ```ts
 * export function createBucketBuilder(): IBucketBuilder {
 *   return taggedBuilder<BucketBuilderProps, BucketBuilder>(BucketBuilder);
 * }
 *
 * createBucketBuilder()
 *   .tag("Project", "claude-rig")
 *   .tags({ Owner: "platform", Environment: "prod" })
 *   .build(stack, "Bucket");
 * ```
 */
export function taggedBuilder<Props extends object, T extends ObjectWithProps<Props>>(
  constructor: Constructor<T>,
): ITaggedBuilder<Props, T> {
  const inner = Builder<Props, T>(constructor);
  const accumulator = new Map<string, string>();

  // core's Builder proxy installs no `set` trap, so symbol-keyed writes pass
  // through to the wrapped instance. One assignment of the live map is enough;
  // mutations to `accumulator` are visible to readers without re-syncing.
  (inner as unknown as TaggedInstance)[BUILDER_TAGS] = accumulator;

  // Records a pre-validated key/value pair and emits a process warning when
  // the key was already set, so override is visible at the call site.
  const recordTag = (key: string, value: string): void => {
    if (accumulator.has(key)) {
      const previous = accumulator.get(key);
      process.emitWarning(
        `Tag "${key}" was already set to "${previous ?? ""}" and is being overwritten with "${value}". ` +
          "Last write wins; remove the duplicate to silence this warning.",
        { type: "ComposureCDKTagOverride" },
      );
    }
    accumulator.set(key, value);
  };

  const buildFn = (...args: unknown[]): object => {
    const target = inner as unknown as { build: (...a: unknown[]) => object };
    const result = target.build(...args);
    applyBuilderTags(result, accumulator);
    return result;
  };

  // Pre-bound interceptors so each property access doesn't allocate a new
  // closure for the three special method names. They reference `outer` to
  // return the wrapper from chained calls, so they are declared after the
  // Proxy is built; the Proxy's `get` trap closes over them and only reads
  // them when a property is accessed (after this function returns).
  const outer: ITaggedBuilder<Props, T> = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "tag") return tagFn;
      if (prop === "tags") return tagsFn;
      if (prop === "build") return buildFn;

      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const ret = (value as (...a: unknown[]) => unknown).apply(target, args);
          return ret === inner ? outer : ret;
        };
      }
      return value;
    },
  }) as ITaggedBuilder<Props, T>;

  const tagFn = (key: string, value: string): ITaggedBuilder<Props, T> => {
    validateTag(key, value);
    recordTag(key, value);
    return outer;
  };
  const tagsFn = (values: Record<string, string>): ITaggedBuilder<Props, T> => {
    validateTagRecord(values);
    for (const [key, value] of Object.entries(values)) {
      recordTag(key, value);
    }
    return outer;
  };

  return outer;
}
