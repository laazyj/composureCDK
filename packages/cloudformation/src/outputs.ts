import { CfnOutput } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { type AfterBuildHook, type Resolvable, resolve } from "@composurecdk/core";

/**
 * Defines a CloudFormation stack output with a value that can be a
 * {@link Resolvable} — either a concrete string or a {@link Ref} that
 * resolves against the system's build results at build time.
 *
 * @typeParam T - The composed system's build result type. When `outputs()`
 * is passed to {@link ComposedSystem.afterBuild | .afterBuild()} the type
 * is inferred, making `scope` component keys statically checked.
 */
export interface OutputDefinition<T extends object = object> {
  /** The output value, or a Ref that resolves to one. */
  value: Resolvable<string>;

  /** A description of the output. */
  description?: string;

  /**
   * The name under which the output is exported for cross-stack references.
   * When set, this creates a CloudFormation Export.
   */
  exportName?: string;

  /**
   * The scope to attach this output to. Either an `IConstruct` (typically a
   * Stack reference held by the caller — useful with
   * {@link ComposedSystem.withStacks | .withStacks()}) or the string key of
   * a component in the composed system, in which case the output lands in
   * whichever scope that component was built into (useful with
   * {@link ComposedSystem.withStackStrategy | .withStackStrategy()}).
   *
   * When omitted, the output falls back to the top-level scope passed to
   * `build()` — the same scope the `AfterBuildHook` receives.
   */
  scope?: IConstruct | (keyof T & string);
}

/**
 * A record of output definitions keyed by logical output name.
 */
export type OutputDefinitions<T extends object = object> = Record<string, OutputDefinition<T>>;

/**
 * Returns an {@link AfterBuildHook} that creates CloudFormation stack outputs
 * from the composed system's build results.
 *
 * Each output definition's `value` can be a concrete string or a {@link Ref}
 * that is resolved against the build results. An optional `scope` routes
 * individual outputs to specific stacks — either as a direct `IConstruct`
 * or as a component key string (statically typed against the composed
 * system's component keys).
 *
 * Intended for use with {@link ComposedSystem.afterBuild}.
 *
 * @param defs - A record of output definitions keyed by logical name.
 * @returns An {@link AfterBuildHook} that creates `CfnOutput` constructs.
 *
 * @example
 * ```ts
 * import { compose, ref } from "@composurecdk/core";
 * import { outputs } from "@composurecdk/cloudformation";
 *
 * compose(
 *   { site: createBucketBuilder(), cdn: createDistributionBuilder(), dns: createZoneBuilder() },
 *   { site: [], cdn: ["site"], dns: [] },
 * )
 *   .withStacks({ site: siteStack, cdn: siteStack, dns: dnsStack })
 *   .afterBuild(outputs({
 *     DistributionUrl: {
 *       value: ref("cdn", (r: DistributionBuilderResult) =>
 *         `https://${r.distribution.distributionDomainName}`),
 *       scope: "cdn",
 *     },
 *     BucketName: {
 *       value: ref("site", (r: BucketBuilderResult) => r.bucket.bucketName),
 *       scope: siteStack,
 *     },
 *     NameServers: {
 *       value: ref("dns", (r: ZoneBuilderResult) =>
 *         Fn.join(",", r.zone.hostedZoneNameServers!)),
 *       scope: "dns",
 *     },
 *   }))
 *   .build(app, "StaticWebsite");
 * ```
 */
export function outputs<T extends object = object>(defs: OutputDefinitions<T>): AfterBuildHook<T> {
  return (scope, _id, results, componentScopes) => {
    const resultAsContext = results as Record<string, object>;
    const scopesByKey = componentScopes as Record<string, IConstruct | undefined>;

    for (const [name, def] of Object.entries(defs)) {
      let target: IConstruct;
      if (typeof def.scope === "string") {
        const resolved = scopesByKey[def.scope];
        if (resolved === undefined) {
          throw new Error(`outputs(): "${name}" refers to unknown component "${def.scope}".`);
        }
        target = resolved;
      } else if (def.scope !== undefined) {
        target = def.scope;
      } else {
        target = scope;
      }

      new CfnOutput(target, name, {
        value: resolve(def.value, resultAsContext),
        ...(def.description !== undefined ? { description: def.description } : {}),
        ...(def.exportName !== undefined ? { exportName: def.exportName } : {}),
      });
    }
  };
}
