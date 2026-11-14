import { type IConstruct } from "constructs";
import { at, buildIdOf } from "./build-id.js";
import { addDependencies, type DependencySource } from "./dependencies.js";
import { type Lifecycle } from "./lifecycle.js";

/** Options for {@link deployAfter}. */
export interface DeployAfterOptions<T extends object> {
  /** Selects the construct in the component's result that gets the edge. */
  readonly target: (result: T) => IConstruct;
  /**
   * What `target` must deploy after. Prefer a ref to one construct
   * (`ref("delegation", (r) => r.record)`) over a whole-component ref, which
   * reaches every construct in the sibling's result, including any it was
   * passed. See {@link DependencySource}.
   */
  readonly after: readonly DependencySource[];
}

/**
 * Orders the construct `target` selects from `inner`'s result after `after`
 * at deploy time, for when nothing in its template references them. It calls
 * {@link addDependencies} once `inner` has built.
 *
 * Refs in `after` resolve against the build context: a sibling declared in the
 * `compose()` dependency record, or, failing that, a component of the same name
 * in a parent system's context (ADR-0003). An `at()` pin on `inner` is kept.
 * See ADR-0021 for why this is a combinator.
 *
 * @param inner - The component to wrap.
 * @param options - The construct that waits, and what it waits for.
 * @returns A {@link Lifecycle} with the same result as `inner`.
 *
 * @example
 * ```ts
 * const zoneOf = (r: HostedZoneBuilderResult) => r.hostedZone;
 *
 * compose(
 *   {
 *     zone: createHostedZoneBuilder().zoneName("app.example.com"),
 *     delegation: createCrossAccountZoneDelegationBuilder()
 *       .delegatedZone(ref("zone", zoneOf))
 *       .parentHostedZoneName("example.com")
 *       .delegationRole("arn:aws:iam::111122223333:role/delegation"),
 *     certificate: deployAfter(
 *       createCertificateBuilder().domainName("app.example.com").validationZone(ref("zone", zoneOf)),
 *       {
 *         target: (r) => r.certificate,
 *         after: [ref("delegation", (r: CrossAccountZoneDelegationBuilderResult) => r.record)],
 *       },
 *     ),
 *   },
 *   { zone: [], delegation: ["zone"], certificate: ["zone", "delegation"] },
 * );
 * ```
 */
export function deployAfter<T extends object>(
  inner: Lifecycle<T>,
  options: DeployAfterOptions<T>,
): Lifecycle<T> {
  const { target, after } = options;
  const ordered: Lifecycle<T> = {
    build: (scope, id, context) => {
      const result = inner.build(scope, id, context);
      addDependencies(target(result), after, context ?? {});
      return result;
    },
  };
  // A wrapper that builds `inner` under the same id must keep its at() pin.
  const pinned = buildIdOf(inner);
  return pinned === undefined ? ordered : at(pinned, ordered);
}
