import { type IConstruct } from "constructs";
import { at, buildIdOf } from "./build-id.js";
import { addDependencies, type DependencySource } from "./dependencies.js";
import { type Lifecycle } from "./lifecycle.js";

/** Options for {@link dependsOn}. */
export interface DependsOnOptions<T extends object> {
  /** Selects the construct in the component's result that gets the dependency. */
  readonly target: (result: T) => IConstruct;
  /** What `target` depends on. Prefer a construct-level ref; see {@link DependencySource}. */
  readonly sources: readonly DependencySource[];
}

/**
 * Makes the construct `target` selects from `inner`'s result depend on
 * `sources`, for when nothing in its template references them. It calls
 * {@link addDependencies} once `inner` has built, so CloudFormation deploys
 * `target` after `sources`.
 *
 * Refs in `sources` resolve against the build context: a sibling declared in
 * the `compose()` dependency record, or, failing that, a component of the same
 * name in a parent system's context (ADR-0003). An `at()` pin on `inner` is
 * kept. See ADR-0022 for why this is a combinator.
 *
 * Prefer a builder's own option where it has one, such as custom-resources'
 * `.dependsOn()` or lambda's `.invokeOnDeploy({ after })`: they pick the
 * target, and `.invokeOnDeploy()` also waits for the execution role.
 *
 * @param inner - The component to wrap.
 * @param options - `target`, and the `sources` it depends on.
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
 *     certificate: dependsOn(
 *       createCertificateBuilder().domainName("app.example.com").validationZone(ref("zone", zoneOf)),
 *       {
 *         target: (r) => r.certificate,
 *         sources: [ref("delegation", (r: CrossAccountZoneDelegationBuilderResult) => r.record)],
 *       },
 *     ),
 *   },
 *   { zone: [], delegation: ["zone"], certificate: ["zone", "delegation"] },
 * );
 * ```
 */
export function dependsOn<T extends object>(
  inner: Lifecycle<T>,
  options: DependsOnOptions<T>,
): Lifecycle<T> {
  const { target, sources } = options;
  const dependent: Lifecycle<T> = {
    build: (scope, id, context) => {
      const result = inner.build(scope, id, context);
      addDependencies(target(result), sources, context ?? {});
      return result;
    },
  };
  // Keep the at() pin: see BUILD_ID.
  const pinned = buildIdOf(inner);
  return pinned === undefined ? dependent : at(pinned, dependent);
}
