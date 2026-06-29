import { type Lifecycle } from "./lifecycle.js";

/**
 * @internal Brands a {@link Lifecycle} produced by {@link at} with the construct
 * id it should build under, so {@link compose} can read it without `instanceof`.
 *
 * Registered in the global symbol registry for the same dual-package reason as
 * the `Ref` brand (ADR-0007): the ESM and CommonJS copies of `@composurecdk/core`
 * can both load in one process, and a brand minted by either copy must be
 * recognised by either.
 */
export const BUILD_ID = Symbol.for("composurecdk.buildId");

/**
 * Tags a {@link Lifecycle} with an explicit construct id, decoupling the id it
 * builds under from the key it is registered under in {@link compose}.
 *
 * By default `compose` derives each component's build id from its key as
 * `` `${parentId}/${key}` ``. Nesting an already-deployed system under a new key
 * therefore lengthens every construct path and rotates every CloudFormation
 * logical id — a destructive replacement. `at` pins the id so the component
 * builds at the same path it did standalone, preserving logical ids.
 *
 * The returned value is an ordinary {@link Lifecycle}; the id rides on a
 * {@link BUILD_ID} brand that only `compose` reads. Build behaviour is otherwise
 * unchanged — the tag forwards the id `compose` passes straight to the inner
 * component, so the `id` argument is honoured end to end rather than discarded.
 *
 * The pinned id shares the sibling namespace of the scope it is built into, so
 * it must not collide with another component's id; `compose` throws if it does.
 *
 * @param id - The construct id the component should build under.
 * @param inner - The component to tag.
 * @returns A {@link Lifecycle} that `compose` builds under `id`.
 *
 * @example
 * ```ts
 * compose(
 *   { jduffett: at("jasonduffett.net", apexSystem), clara },
 *   { jduffett: [], clara: [] },
 * ).build(app, "jasonduffett.net");
 * // apex components build at `jasonduffett.net/<key>`, not
 * // `jasonduffett.net/jduffett/<key>` — logical ids preserved.
 * ```
 */
export function at<T extends object>(id: string, inner: Lifecycle<T>): Lifecycle<T> {
  const tagged: Lifecycle<T> & { readonly [BUILD_ID]: string } = {
    [BUILD_ID]: id,
    build: (scope, buildId, context) => inner.build(scope, buildId, context),
  };
  return tagged;
}

/**
 * Reads the {@link BUILD_ID} brand off a component, returning the id it was
 * tagged with by {@link at}, or `undefined` if it was not tagged.
 *
 * @internal Consumed by {@link compose} to override the default id derivation.
 */
export function buildIdOf(component: Lifecycle): string | undefined {
  const value = (component as { [BUILD_ID]?: unknown })[BUILD_ID];
  return typeof value === "string" ? value : undefined;
}
