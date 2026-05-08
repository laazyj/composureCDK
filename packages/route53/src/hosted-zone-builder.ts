import { PublicHostedZone, type PublicHostedZoneProps } from "aws-cdk-lib/aws-route53";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { HOSTED_ZONE_DEFAULTS } from "./defaults.js";
import { resolveQueryLogging, type QueryLoggingConfig } from "./query-logging.js";

/**
 * Configuration properties for the Route53 public hosted zone builder.
 *
 * Hides the CDK `queryLogsLogGroupArn` field in favour of {@link queryLogging}
 * — a discriminated config that supports a `false` opt-out, a user-supplied
 * pre-existing log group ARN, or a customizable auto-managed `LogGroup`
 * provisioned alongside the hosted zone.
 */
export interface HostedZoneBuilderProps extends Omit<
  PublicHostedZoneProps,
  "queryLogsLogGroupArn"
> {
  /**
   * See {@link QueryLoggingConfig}. Defaults to an auto-managed CloudWatch
   * log group and a single shared resource policy granting Route 53 write
   * access — the secure path is the easy path. Set to `false` to opt out, or
   * to `{ logGroupArn }` to bring your own log group.
   */
  queryLogging?: QueryLoggingConfig;
}

/**
 * The build output of an {@link IHostedZoneBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface HostedZoneBuilderResult {
  /** The Route53 public hosted zone construct created by the builder. */
  hostedZone: PublicHostedZone;
  /**
   * The CloudWatch log group auto-created for DNS query logging, or
   * `undefined` when query logging was disabled or the user supplied their
   * own log group ARN. The shared `AWS::Logs::ResourcePolicy` is
   * intentionally not exposed: it is stack-scoped, shared across every
   * hosted zone in the stack, and not safe to mutate from a single
   * builder's result.
   */
  queryLogGroup?: LogGroup;
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
 * public hosted zone with the configured properties — including the
 * auto-managed DNS query-log group and shared resource policy — and returns a
 * {@link HostedZoneBuilderResult}.
 *
 * @example
 * ```ts
 * const zone = createHostedZoneBuilder()
 *   .zoneName("example.com")
 *   .comment("Primary customer-facing domain");
 * ```
 */
export type IHostedZoneBuilder = ITaggedBuilder<HostedZoneBuilderProps, HostedZoneBuilder>;

class HostedZoneBuilder implements Lifecycle<HostedZoneBuilderResult> {
  props: Partial<HostedZoneBuilderProps> = {};

  build(scope: IConstruct, id: string): HostedZoneBuilderResult {
    if (!this.props.zoneName) {
      throw new Error(
        `HostedZoneBuilder "${id}" requires a zoneName. ` +
          `Call .zoneName() with a fully-qualified domain.`,
      );
    }

    const { queryLogging, ...zoneProps } = {
      ...HOSTED_ZONE_DEFAULTS,
      ...this.props,
    };

    const { queryLogGroup, queryLogsLogGroupArn, policy } = resolveQueryLogging(
      scope,
      id,
      this.props.zoneName,
      queryLogging,
    );

    const hostedZone = new PublicHostedZone(scope, id, {
      ...zoneProps,
      zoneName: this.props.zoneName,
      queryLogsLogGroupArn,
    });

    if (policy) hostedZone.node.addDependency(policy);

    return { hostedZone, queryLogGroup };
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
  return taggedBuilder<HostedZoneBuilderProps, HostedZoneBuilder>(HostedZoneBuilder);
}
