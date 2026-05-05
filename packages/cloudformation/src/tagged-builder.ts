import { Builder } from "@composurecdk/core";
import { applyBuilderTags } from "./apply-builder-tags.js";
import { validateTag } from "./tag-validator.js";

/**
 * Constructs an instance of `T` with no required arguments. Mirrors the
 * constraint used by {@link Builder} in `@composurecdk/core`.
 */
type Constructor<T> = new () => T;

/**
 * Constrains `T` to have a mutable `props` property. Mirrors the constraint
 * used by {@link Builder} in `@composurecdk/core`.
 */
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
 * Symbol-keyed field set on the wrapped instance to expose accumulated tags
 * to builder code that creates constructs outside the standard `build()`
 * path — the canonical case is {@link createStackBuilder}'s
 * `toScopeFactory()`, which produces a Stack via a deferred factory rather
 * than as part of a `BuilderResult`.
 *
 * Internal to `@composurecdk/cloudformation`. External consumers should rely
 * on the standard `build()` flow, which applies tags via the wrapper.
 */
export const BUILDER_TAGS = Symbol.for("composurecdk.builderTags");

interface TaggedInstance {
  [BUILDER_TAGS]?: ReadonlyMap<string, string>;
}

/**
 * Reads the tag accumulator the wrapper has synchronised onto a builder
 * instance, returning an empty map when none has been set (e.g. when the
 * class is constructed outside {@link taggedBuilder}).
 *
 * The standard `build()` flow does **not** read this — it draws from the
 * wrapper's closure-held accumulator directly. This getter exists for
 * out-of-band paths where a builder produces a construct outside its
 * declared result type. The only such path today is
 * `StackBuilder.toScopeFactory()`, which returns a Stack-creating function
 * the wrapper cannot observe.
 *
 * Returns a snapshot map; mutations to the returned value do not affect
 * the wrapper's accumulator.
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
 *    accumulate them in a closure-held insertion-ordered map. Repeated
 *    keys overwrite earlier values and emit `process.emitWarning` so the
 *    override is visible at the configuring call site.
 * 2. Synchronises the current accumulator onto the wrapped instance via a
 *    symbol-keyed field, so builder code that produces constructs outside
 *    the standard build result (e.g. `StackBuilder.toScopeFactory()`) can
 *    read the same tag state. Use {@link getBuilderTags} to access it.
 * 3. Intercepts `build()` to call {@link applyBuilderTags} on the result
 *    after the inner build completes.
 * 4. Passes every other access through to the inner Proxy unchanged. Inner
 *    methods that return the inner Proxy (chainable setters) are
 *    re-wrapped so the chain returns the outer Proxy and the new tag
 *    methods stay reachable.
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
  // through to the wrapped instance. Used to expose accumulated tags to
  // builder code that creates constructs outside `build()`.
  const syncToInstance = (): void => {
    (inner as unknown as TaggedInstance)[BUILDER_TAGS] = new Map(accumulator);
  };

  const setTag = (key: string, value: string): void => {
    validateTag(key, value);
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

  const outer: ITaggedBuilder<Props, T> = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "tag") {
        return (key: string, value: string) => {
          setTag(key, value);
          syncToInstance();
          return outer;
        };
      }
      if (prop === "tags") {
        return (values: Record<string, string>) => {
          for (const [key, value] of Object.entries(values)) {
            setTag(key, value);
          }
          syncToInstance();
          return outer;
        };
      }
      if (prop === "build") {
        return (...args: unknown[]) => {
          const buildFn = (target as Record<string, unknown>)[prop] as (...a: unknown[]) => object;
          const result = buildFn.apply(target, args);
          applyBuilderTags(result, accumulator);
          return result;
        };
      }

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

  return outer;
}
