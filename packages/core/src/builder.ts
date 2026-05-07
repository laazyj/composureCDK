/**
 * Constructs an instance of `T`.
 */
type Constructor<T> = new () => T;

/**
 * Constrains `T` to have a mutable `props` property of type `Props`.
 * Classes used with {@link Builder} must expose their configuration this way.
 */
interface ObjectWithProps<Props extends object> {
  props: Partial<Props>;
}

/**
 * Optional hook a builder class can implement to clone non-`props` state
 * during {@link IBuilder.copy}.
 *
 * The default `.copy()` shallow-clones `props` and wraps a fresh instance.
 * State stored outside `props` (private fields, internal accumulators) is
 * invisible to that default. A class with such state defines a method
 * keyed by this symbol to copy it onto the new instance.
 *
 * See ADR-0005 for the full protocol, including how decorator layers
 * participate.
 *
 * @example
 * ```ts
 * class StackBuilder {
 *   props: Partial<StackProps> = {};
 *   readonly #tags: [string, string][] = [];
 *
 *   [COPY_STATE](target: StackBuilder): void {
 *     target.#tags.push(...this.#tags);
 *   }
 * }
 * ```
 */
export const COPY_STATE = Symbol.for("composurecdk.builder.copyState");

/**
 * A fluent builder interface generated from a props type and a target class.
 *
 * For each key in `Props`, the builder exposes an overloaded method:
 * - Called with an argument: sets the prop value and returns the builder for chaining.
 * - Called with no arguments: returns the current prop value.
 *
 * Methods from `T` that return `T` (chainable methods) have their return type
 * replaced to return the builder. All other members of `T` pass through as-is,
 * allowing methods like `build()` to be called directly on the builder.
 *
 * Every builder also exposes {@link IBuilder.copy | `.copy()`}, which returns
 * an independent builder with the same configured state.
 *
 * @typeParam Props - The configurable properties.
 * @typeParam T - The target class the builder wraps.
 */
export type IBuilder<Props extends object, T> = {
  [K in keyof Props]-?: ((arg: Props[K]) => IBuilder<Props, T>) & (() => Props[K]);
} & {
  [K in keyof T]: T[K] extends (...args: infer A) => T ? (...args: A) => IBuilder<Props, T> : T[K];
} & {
  /**
   * Returns an independent builder with the same configured props and any
   * state that the underlying class copies via {@link COPY_STATE}.
   *
   * Mutations to the returned builder do not affect the original, and
   * vice versa.
   *
   * `props` is shallow-cloned (`{ ...this.props }`). Top-level keys are
   * independent; nested object references (CDK constructs, IRoles, IVpcs,
   * etc.) are shared by design — they are construct identities, not
   * configuration data. Builders with internal lists/maps/sets that should
   * be deep-cloned implement {@link COPY_STATE}.
   *
   * Use cases:
   * - **Variant authoring** — derive multiple builders from a shared base
   *   (`const us = base.copy().region("us-east-1")`).
   * - **Strategy hand-off snapshot** — pass an isolated builder to a stack
   *   strategy (`singleStack(base.copy())`) so later mutations to the
   *   original don't leak into the strategy's lazy `build()`.
   *
   * See ADR-0005 for the design rationale.
   */
  copy(): IBuilder<Props, T>;
};

/**
 * Creates a fluent builder wrapping an instance of `T`.
 *
 * The builder is backed by a {@link Proxy} that intercepts property access:
 * - For `copy`: returns a function that produces an independent builder with
 *   the same configured state (see {@link IBuilder.copy}).
 * - For keys in `Props`: returns a getter/setter function. When called with a
 *   value, it sets the prop and returns the builder. When called with no args,
 *   it returns the current value.
 * - For methods on `T` that return `T`: wraps them to return the builder instead.
 * - For all other members: delegates directly to the underlying instance.
 *
 * @param constructor - The class to instantiate and wrap.
 * @param instance - Optional pre-existing instance to wrap. Defaults to
 *   `new constructor()`. Used internally by {@link IBuilder.copy} to wrap a
 *   freshly cloned instance without re-running the constructor for new state.
 * @returns A fluent {@link IBuilder} wrapping `instance`.
 */
export function Builder<Props extends object, T extends ObjectWithProps<Props>>(
  constructor: Constructor<T>,
  instance: T = new constructor(),
): IBuilder<Props, T> {
  const methods = new Set(
    Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).filter(
      (key) =>
        key !== "constructor" && typeof (instance as Record<string, unknown>)[key] === "function",
    ),
  );

  const proxy: IBuilder<Props, T> = new Proxy(instance, {
    get(target: T, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop) as unknown;
      }

      if (prop === "copy") {
        return () => {
          const next = new constructor();
          next.props = { ...target.props };
          const hook = (target as unknown as Record<symbol, unknown>)[COPY_STATE];
          if (typeof hook === "function") {
            (hook as (next: T) => void).call(target, next);
          }
          return Builder<Props, T>(constructor, next);
        };
      }

      // Props getter/setter
      if (!methods.has(prop)) {
        return (...args: unknown[]) => {
          if (args.length === 0) {
            return target.props[prop as keyof Props];
          }
          target.props[prop as keyof Props] = args[0] as Props[keyof Props];
          return proxy;
        };
      }

      // Method on target — wrap to return proxy for chainable methods
      const method = (target as Record<string, unknown>)[prop] as (...a: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const result: unknown = method.apply(target, args);
        return result === target ? proxy : result;
      };
    },
  }) as IBuilder<Props, T>;

  return proxy;
}
