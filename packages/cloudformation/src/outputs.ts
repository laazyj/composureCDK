import { CfnOutput } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { type AfterBuildHook, type Resolvable, resolve } from "@composurecdk/core";

/**
 * Defines a CloudFormation stack output with a value that can be a
 * {@link Resolvable} — either a concrete string or a {@link Ref} that
 * resolves against the system's build results at build time.
 */
export interface OutputDefinition {
  /** The output value, or a Ref that resolves to one. */
  value: Resolvable<string>;

  /** A description of the output. */
  description?: string;

  /**
   * The name under which the output is exported for cross-stack references.
   * When set, this creates a CloudFormation Export.
   */
  exportName?: string;
}

/**
 * A record of output definitions keyed by logical output name.
 */
export type OutputDefinitions = Record<string, OutputDefinition>;

/**
 * Returns an {@link AfterBuildHook} that creates CloudFormation stack outputs
 * from the composed system's build results.
 *
 * Each output definition's `value` can be a concrete string or a {@link Ref}
 * that is resolved against the build results. This enables outputs that
 * reference values produced by composed components without breaking the
 * composition abstraction.
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
 *   { site: createBucketBuilder(), cdn: createDistributionBuilder() },
 *   { site: [], cdn: ["site"] },
 * )
 *   .afterBuild(outputs({
 *     DistributionUrl: {
 *       value: ref("cdn", (r: DistributionBuilderResult) =>
 *         `https://${r.distribution.distributionDomainName}`),
 *       description: "CloudFront distribution URL",
 *     },
 *     BucketName: {
 *       value: ref("site", (r: BucketBuilderResult) => r.bucket.bucketName),
 *       description: "S3 bucket name for site content",
 *     },
 *   }))
 *   .build(stack, "StaticWebsite");
 * ```
 */
export function outputs(defs: OutputDefinitions): AfterBuildHook<object> {
  return (scope: IConstruct, _id: string, results: object) => {
    const resultAsContext = results as Record<string, object>;

    for (const [name, def] of Object.entries(defs)) {
      new CfnOutput(scope, name, {
        value: resolve(def.value, resultAsContext),
        ...(def.description !== undefined ? { description: def.description } : {}),
        ...(def.exportName !== undefined ? { exportName: def.exportName } : {}),
      });
    }
  };
}
