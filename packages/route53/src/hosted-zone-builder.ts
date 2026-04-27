import { PublicHostedZone, type PublicHostedZoneProps } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { HOSTED_ZONE_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 public hosted zone builder.
 *
 * Aliases the CDK {@link PublicHostedZoneProps} so every zone property is
 * available as a fluent setter on the builder. No additional builder-specific
 * options are defined today — query logging requires a pre-configured log
 * group (see {@link PublicHostedZoneProps.queryLogsLogGroupArn | queryLogsLogGroupArn})
 * which the user supplies directly.
 */
export type HostedZoneBuilderProps = PublicHostedZoneProps;

/**
 * The build output of an {@link IHostedZoneBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface HostedZoneBuilderResult {
  /** The Route53 public hosted zone construct created by the builder. */
  hostedZone: PublicHostedZone;
}

/**
 * A fluent builder for configuring and creating a Route53 public hosted zone.
 *
 * Each configuration property from the CDK {@link PublicHostedZoneProps} is
 * exposed as an overloaded method: call with a value to set it (returns the
 * builder for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates a
 * public hosted zone with the configured properties and returns a
 * {@link HostedZoneBuilderResult}.
 *
 * @example
 * ```ts
 * const zone = createHostedZoneBuilder()
 *   .zoneName("example.com")
 *   .comment("Primary customer-facing domain");
 * ```
 */
export type IHostedZoneBuilder = IBuilder<HostedZoneBuilderProps, HostedZoneBuilder>;

class HostedZoneBuilder implements Lifecycle<HostedZoneBuilderResult> {
  props: Partial<HostedZoneBuilderProps> = {};

  build(scope: IConstruct, id: string): HostedZoneBuilderResult {
    if (!this.props.zoneName) {
      throw new Error(
        `HostedZoneBuilder "${id}" requires a zoneName. ` +
          `Call .zoneName() with a fully-qualified domain.`,
      );
    }

    const mergedProps = {
      ...HOSTED_ZONE_DEFAULTS,
      ...this.props,
    } as PublicHostedZoneProps;

    const hostedZone = new PublicHostedZone(scope, id, mergedProps);

    return { hostedZone };
  }
}

/**
 * Creates a new {@link IHostedZoneBuilder} for configuring a Route53 public
 * hosted zone.
 *
 * This is the entry point for defining a public hosted zone component. The
 * returned builder exposes every {@link HostedZoneBuilderProps} property as a
 * fluent setter/getter and implements {@link Lifecycle} for use with
 * {@link compose}.
 *
 * @returns A fluent builder for a Route53 public hosted zone.
 *
 * @example
 * ```ts
 * const zone = createHostedZoneBuilder().zoneName("example.com");
 *
 * // Use standalone:
 * const result = zone.build(stack, "SiteZone");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { zone, cert: createCertificateBuilder()
 *       .domainName("example.com")
 *       .validationZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone)) },
 *   { zone: [], cert: ["zone"] },
 * );
 * ```
 */
export function createHostedZoneBuilder(): IHostedZoneBuilder {
  return Builder<HostedZoneBuilderProps, HostedZoneBuilder>(HostedZoneBuilder);
}
