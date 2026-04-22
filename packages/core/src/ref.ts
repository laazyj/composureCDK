/**
 * A lazy reference to a value produced by another component at build time.
 *
 * `Ref` enables declarative cross-component wiring: a builder can capture a
 * reference to a dependency's output at configuration time, and the value is
 * resolved when the system is built. This keeps all configuration in one
 * place — no split between eager props and deferred hooks.
 *
 * Create a `Ref` with the {@link ref} factory, then optionally narrow it
 * with {@link Ref.get | .get()} or transform it with {@link Ref.map | .map()}.
 *
 * @typeParam T - The type of the value this reference resolves to.
 *
 * @example
 * ```ts
 * // Reference a component's full build output
 * ref<FunctionBuilderResult>("handler")
 *
 * // Narrow to a specific property
 * ref<FunctionBuilderResult>("handler").get("function")
 *
 * // Transform the referenced value
 * ref<FunctionBuilderResult>("handler")
 *   .get("function")
 *   .map(fn => new LambdaIntegration(fn))
 * ```
 */
export class Ref<T> {
  readonly #resolver: (context: Record<string, object>) => T;

  private constructor(resolver: (context: Record<string, object>) => T) {
    this.#resolver = resolver;
  }

  /**
   * Creates a `Ref` that resolves to a component's full build output.
   *
   * @param component - The key of the component in the composed system.
   * @returns A `Ref` to the component's build result.
   */
  static to<T extends object>(component: string): Ref<T> {
    return new Ref<T>((context) => {
      if (!(component in context)) {
        throw new Error(
          `Ref to "${component}" cannot be resolved: component not found in context. ` +
            `Ensure "${component}" is declared as a dependency.`,
        );
      }
      return context[component] as T;
    });
  }

  /**
   * Narrows this reference to a specific property of the resolved value.
   *
   * @param key - The property key to select.
   * @returns A new `Ref` to the selected property.
   */
  get<K extends keyof T>(key: K): Ref<T[K]> {
    return new Ref<T[K]>((context) => this.#resolver(context)[key]);
  }

  /**
   * Transforms the resolved value using the provided function.
   *
   * This is the primary way to adapt a dependency's output into the shape
   * a consumer needs — for example, wrapping a Lambda function in a
   * `LambdaIntegration`.
   *
   * @param fn - A function that transforms the resolved value.
   * @returns A new `Ref` whose resolved value is the result of `fn`.
   */
  map<U>(fn: (value: T) => U): Ref<U> {
    return new Ref<U>((context) => fn(this.#resolver(context)));
  }

  /**
   * Resolves this reference against a build context.
   *
   * Called internally during the build phase. Not typically called by users.
   *
   * @param context - The resolved dependency outputs, keyed by component name.
   * @returns The resolved value.
   */
  resolve(context: Record<string, object>): T {
    return this.#resolver(context);
  }
}

/**
 * Creates a {@link Ref} to a component's build output within a composed system.
 *
 * Called with just a component key, it returns a `Ref` to the full build result
 * that can be further narrowed with {@link Ref.get | .get()} or
 * {@link Ref.map | .map()}.
 *
 * Called with a transform function, it returns a `Ref` whose resolved value is
 * the result of applying the transform to the component's build output. This is
 * a shorthand for `ref<T>(component).map(transform)`.
 *
 * @param component - The key of the component in the composed system.
 * @param transform - Optional function that transforms the component's build output.
 * @returns A `Ref` to the component's build result, optionally transformed.
 *
 * @example
 * ```ts
 * // Without transform — chain .get() / .map() as needed
 * ref<FunctionBuilderResult>("handler")
 *   .get("function")
 *   .map(fn => new LambdaIntegration(fn))
 *
 * // With transform — concise single-call form
 * ref<FunctionBuilderResult>("handler", r => new LambdaIntegration(r.function))
 * ```
 */
export function ref<T extends object>(component: string): Ref<T>;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is inferred from the callback annotation
export function ref<T extends object, U>(component: string, transform: (value: T) => U): Ref<U>;
export function ref<T extends object, U>(
  component: string,
  transform?: (value: T) => U,
): Ref<T> | Ref<U> {
  const base = Ref.to<T>(component);
  return transform ? base.map(transform) : base;
}

/**
 * A value that is either concrete or a lazy {@link Ref} resolved at build time.
 *
 * Builders accept `Resolvable<T>` wherever they would normally accept `T`,
 * making refs and concrete values interchangeable at the call site.
 */
export type Resolvable<T> = T | Ref<T>;

/**
 * Type guard that checks whether a value is a {@link Ref}.
 */
export function isRef<T>(value: Resolvable<T>): value is Ref<T> {
  return value instanceof Ref;
}

/**
 * Resolves a {@link Resolvable} value. If it is a {@link Ref}, resolves it
 * against the provided context (or an empty context if none is given).
 * Otherwise returns the value as-is.
 *
 * @param value - A concrete value or a `Ref`.
 * @param context - The resolved dependency outputs, keyed by component name.
 *   Omit for standalone builds where no refs are in use — a `Ref` resolved
 *   against an empty context will throw "component not found".
 * @returns The concrete value.
 */
export function resolve<T>(value: Resolvable<T>, context?: Record<string, object>): T {
  return isRef(value) ? value.resolve(context ?? {}) : value;
}
