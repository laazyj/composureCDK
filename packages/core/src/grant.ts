import { resolve, type Resolvable } from "./ref.js";

/**
 * A deferred, cross-component permission grant, declared on the **consumer**.
 *
 * ComposureCDK expresses IAM grants where the dependency already points — from
 * the grantee (a role, a function) to the resource it uses — rather than on the
 * resource, which would invert the {@link compose} dependency edge. A `Grant`
 * captures that intent as data at configuration time and applies it during the
 * grantee builder's own `build()`, once the resource {@link Ref} it references
 * has resolved against the build context.
 *
 * `Grant` is generic over the grantee type `G` so this contract stays free of
 * any `aws-cdk-lib` dependency. Grantee packages instantiate it as
 * `Grant<IGrantable>`; resource packages produce one via {@link grantVia}.
 *
 * @typeParam G - The grantee type the grant is applied to (e.g. `IGrantable`).
 */
export interface Grant<G> {
  /**
   * Applies the grant to `grantee`, resolving any {@link Ref} to the target
   * resource against `context`.
   *
   * @param grantee - The principal receiving the permission.
   * @param context - The resolved dependency outputs, keyed by component name.
   */
  applyTo(grantee: G, context: Record<string, object>): void;
}

/**
 * Builds a {@link Grant} from a resource and a function that applies a
 * permission to a grantee.
 *
 * Resource packages use this to expose capability helpers (e.g.
 * `tableGrants.readWrite`, `bucketGrants.write`). When the returned grant is
 * applied, `resource` is resolved against the build context and passed to
 * `apply` together with the grantee.
 *
 * @typeParam R - The resolved resource type (e.g. `ITable`, `IBucket`).
 * @typeParam G - The grantee type (e.g. `IGrantable`).
 * @param resource - The resource to grant on, concrete or a {@link Ref}.
 * @param apply - Applies the permission for `grantee` to the resolved `resource`.
 * @returns A {@link Grant} to pass to a grantee builder's `grant(...)`.
 *
 * @example
 * ```ts
 * // In a resource package:
 * export const bucketGrants = {
 *   write: (b: Resolvable<IBucket>): Grant<IGrantable> =>
 *     grantVia(b, (bucket, grantee: IGrantable) => bucket.grantWrite(grantee)),
 * };
 * ```
 */
export function grantVia<R, G>(
  resource: Resolvable<R>,
  apply: (resource: R, grantee: G) => void,
): Grant<G> {
  return {
    applyTo(grantee, context) {
      apply(resolve(resource, context), grantee);
    },
  };
}

/**
 * A queue of pending {@link Grant}s held by a grantee builder.
 *
 * A grantee builder accumulates grants declared at configuration time via
 * {@link GrantQueue.add | add}, then applies them all with
 * {@link GrantQueue.applyTo | applyTo} during its `build()` — once the grantee
 * construct exists and the build context is available.
 * {@link GrantQueue.copyInto | copyInto} supports the builder's `.copy()` hook.
 *
 * @typeParam G - The grantee type applied to (e.g. `IGrantable`).
 *
 * @example
 * ```ts
 * // In a grantee builder:
 * readonly #grants = new GrantQueue<IGrantable>();
 * grant(...grants: Grant<IGrantable>[]): this {
 *   this.#grants.add(...grants);
 *   return this;
 * }
 * // in [COPY_STATE]: this.#grants.copyInto(target.#grants);
 * // in build():     this.#grants.applyTo(grantee, context);
 * ```
 */
export class GrantQueue<G> {
  readonly #grants: Grant<G>[] = [];

  /** Enqueues grants to apply at build time. */
  add(...grants: Grant<G>[]): void {
    this.#grants.push(...grants);
  }

  /** Copies the queued grants onto `target`. @internal — see ADR-0005. */
  copyInto(target: GrantQueue<G>): void {
    target.#grants.push(...this.#grants);
  }

  /**
   * Applies every queued grant to `grantee`, resolving each target resource
   * against `context`.
   */
  applyTo(grantee: G, context: Record<string, object>): void {
    for (const grant of this.#grants) {
      grant.applyTo(grantee, context);
    }
  }
}
