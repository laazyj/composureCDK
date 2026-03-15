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
 * @typeParam Props - The configurable properties.
 * @typeParam T - The target class the builder wraps.
 */
export type IBuilder<Props extends object, T> = {
  [K in keyof Props]-?: ((arg: Props[K]) => IBuilder<Props, T>) & (() => Props[K]);
} & {
  [K in keyof T]: T[K] extends (...args: infer A) => T ? (...args: A) => IBuilder<Props, T> : T[K];
};

/**
 * Creates a fluent builder wrapping an instance of `T`.
 *
 * The builder is backed by a {@link Proxy} that intercepts property access:
 * - For keys in `Props`: returns a getter/setter function. When called with a
 *   value, it sets the prop and returns the builder. When called with no args,
 *   it returns the current value.
 * - For methods on `T` that return `T`: wraps them to return the builder instead.
 * - For all other members: delegates directly to the underlying instance.
 *
 * @param constructor - The class to instantiate and wrap.
 * @returns A fluent {@link IBuilder} wrapping a new instance of `T`.
 */
export function Builder<Props extends object, T extends ObjectWithProps<Props>>(
  constructor: Constructor<T>,
): IBuilder<Props, T> {
  const instance = new constructor();
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
