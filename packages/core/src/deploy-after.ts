import { type IConstruct } from "constructs";
import { at, buildIdOf } from "./build-id.js";
import { addDependencies, type DependencySource } from "./dependencies.js";
import { type Lifecycle } from "./lifecycle.js";

/**
 * Orders the construct `target` selects from `inner`'s result after `sources`
 * at deploy time, for when nothing in its template references them. It calls
 * {@link addDependencies} once `inner` has built.
 *
 * Refs in `sources` resolve against the build context, so the sibling must
 * still be a declared `compose()` dependency. An `at()` pin on `inner` is kept.
 * See ADR-0021 for why this is a combinator and why `target` is required.
 *
 * @param sources - What `target` must deploy after.
 * @param inner - The component to wrap.
 * @param target - Selects the construct in `inner`'s result that gets the edge.
 * @returns A {@link Lifecycle} with the same result as `inner`.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     zone: createHostedZoneBuilder().zoneName("app.example.com"),
 *     delegation: createCrossAccountZoneDelegationBuilder()
 *       .delegatedZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone))
 *       .parentHostedZoneName("example.com")
 *       .delegationRole(delegationRoleArn),
 *     certificate: deployAfter(
 *       [ref("delegation", (r: CrossAccountZoneDelegationBuilderResult) => r.record)],
 *       createCertificateBuilder()
 *         .domainName("app.example.com")
 *         .validationZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone)),
 *       (r) => r.certificate,
 *     ),
 *   },
 *   { zone: [], delegation: ["zone"], certificate: ["zone", "delegation"] },
 * );
 * ```
 */
export function deployAfter<T extends object>(
  sources: readonly DependencySource[],
  inner: Lifecycle<T>,
  target: (result: T) => IConstruct,
): Lifecycle<T> {
  const ordered: Lifecycle<T> = {
    build: (scope, id, context) => {
      const result = inner.build(scope, id, context);
      addDependencies(target(result), sources, context ?? {});
      return result;
    },
  };
  const pinned = buildIdOf(inner);
  return pinned === undefined ? ordered : at(pinned, ordered);
}
