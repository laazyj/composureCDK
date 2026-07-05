/**
 * @internal Brands every {@link Ref} instance so {@link isRef} can recognise
 * one without `instanceof`. `instanceof` is realm-bound: when `@composurecdk/core`
 * is loaded as both ESM and CommonJS in the same process (the dual-package
 * hazard), each copy has its own `Ref` class and `instanceof` fails across the
 * boundary. A `Symbol.for(...)` brand is registered in the global symbol
 * registry, so a `Ref` minted by either copy is still recognised by either.
 */
export const REF_BRAND = Symbol.for("composurecdk.ref");

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
  /** @internal Realm-agnostic brand — see {@link REF_BRAND}. */
  readonly [REF_BRAND] = true;

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
   * Creates a `Ref` that resolves a record of {@link Resolvable} values into a
   * record of their resolved results.
   *
   * Backs the {@link combine} factory. Each entry is resolved against the build
   * context independently, so a single consumer can gather values from several
   * siblings at once — the gap {@link Ref.to} leaves, since it reaches only one
   * component.
   *
   * @param refs - A record whose values are concrete values or `Ref`s.
   * @returns A `Ref` to the record of resolved values.
   */
  static combine<R extends Record<string, unknown>>(
    refs: R,
  ): Ref<{ [K in keyof R]: Resolved<R[K]> }> {
    return new Ref((context) => {
      const resolved = {} as { [K in keyof R]: Resolved<R[K]> };
      for (const key of Object.keys(refs) as (keyof R)[]) {
        resolved[key] = resolve(refs[key] as Resolvable<Resolved<R[typeof key]>>, context);
      }
      return resolved;
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
 * The concrete type a {@link Resolvable} resolves to: the inner type of a
 * {@link Ref}, or the value itself when it is already concrete. Mirrors what
 * {@link resolve} returns at runtime.
 */
export type Resolved<R> = R extends Ref<infer T> ? T : R;

/**
 * Combines several {@link Resolvable} values into a single {@link Ref} of their
 * resolved results, keyed the same way as the input record.
 *
 * `ref()` reaches exactly one component, so a consumer that must assemble a
 * construct from **more than one** sibling has no single reference to hand to a
 * `Resolvable<T>` seam. `combine` closes that gap: it resolves each entry
 * against the build context and returns one `Ref`, which drops into any place a
 * `Ref`/`Resolvable` is already accepted — no change to the consuming builder.
 *
 * Entries may mix concrete values and refs. Pass a `transform` to adapt the
 * merged record into the shape the consumer needs (a shorthand for
 * `combine(refs).map(transform)`).
 *
 * @param refs - A record whose values are concrete values or `Ref`s.
 * @param transform - Optional function mapping the merged record to a new value.
 * @returns A `Ref` to the merged record, optionally transformed.
 *
 * @example
 * ```ts
 * // One integration assembled from two siblings — a table and a credentials role
 * addMethod("GET", combine(
 *   { table: ref<TableV2BuilderResult>("table"), role: ref<RoleBuilderResult>("apiRole") },
 *   ({ table, role }) => new AwsIntegration({
 *     service: "dynamodb", action: "Scan",
 *     options: {
 *       credentialsRole: role.role,
 *       requestTemplates: { "application/json": scanTemplate(table.table.tableName) },
 *     },
 *   }),
 * ))
 * ```
 */
export function combine<R extends Record<string, unknown>>(
  refs: R,
): Ref<{ [K in keyof R]: Resolved<R[K]> }>;
export function combine<R extends Record<string, unknown>, U>(
  refs: R,
  transform: (values: { [K in keyof R]: Resolved<R[K]> }) => U,
): Ref<U>;
export function combine<R extends Record<string, unknown>, U>(
  refs: R,
  transform?: (values: { [K in keyof R]: Resolved<R[K]> }) => U,
): Ref<{ [K in keyof R]: Resolved<R[K]> }> | Ref<U> {
  const base = Ref.combine(refs);
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
 *
 * Recognises a `Ref` by its {@link REF_BRAND} symbol rather than `instanceof`,
 * so it works across the dual-package boundary — a `Ref` produced by the ESM
 * copy of `@composurecdk/core` is still recognised by the CommonJS copy and
 * vice versa.
 */
export function isRef<T>(value: Resolvable<T>): value is Ref<T> {
  return typeof value === "object" && value !== null && REF_BRAND in value;
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
