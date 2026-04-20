import {
  ARecord,
  type ARecordProps,
  type IHostedZone,
  type RecordTarget,
} from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { A_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 A record builder.
 *
 * Extends the CDK {@link ARecordProps} but replaces `zone` and `target` with
 * {@link Resolvable} variants so they can be wired from other components in a
 * composed system via {@link ref}.
 */
export interface ARecordBuilderProps extends Omit<ARecordProps, "zone" | "target"> {
  /**
   * The hosted zone in which to create the record. Accepts a {@link Resolvable}
   * so a zone produced by a composed {@link createHostedZoneBuilder} can be
   * wired in via {@link ref}.
   */
  zone?: Resolvable<IHostedZone>;

  /**
   * The record target. Accepts a {@link Resolvable} so alias targets derived
   * from composed components (e.g. a CloudFront distribution) can be wired in
   * via {@link ref} or the helpers in `./alias-targets.js`.
   */
  target?: Resolvable<RecordTarget>;
}

/**
 * The build output of an {@link IARecordBuilder}.
 */
export interface ARecordBuilderResult {
  /** The Route53 A record construct created by the builder. */
  record: ARecord;
}

/**
 * A fluent builder for configuring and creating a Route53 A record (typically
 * an alias record pointing at a CloudFront distribution, ALB, API Gateway
 * custom domain, or another A-record-capable target).
 *
 * @example
 * ```ts
 * const apex = createARecordBuilder()
 *   .zone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone))
 *   .target(cloudfrontAliasTarget(ref("cdn", (r: DistributionBuilderResult) => r.distribution)));
 * ```
 */
export type IARecordBuilder = IBuilder<ARecordBuilderProps, ARecordBuilder>;

class ARecordBuilder implements Lifecycle<ARecordBuilderResult> {
  props: Partial<ARecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): ARecordBuilderResult {
    const { zone, target, ...rest } = this.props;
    if (!zone) {
      throw new Error(`ARecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`);
    }
    if (!target) {
      throw new Error(
        `ARecordBuilder "${id}" requires a target. Call .target() with a RecordTarget.`,
      );
    }

    const resolvedTarget = resolve(target, context);
    const isAlias = resolvedTarget.aliasTarget !== undefined;
    const mergedProps = {
      ...(isAlias ? {} : A_RECORD_DEFAULTS),
      ...rest,
      zone: resolve(zone, context),
      target: resolvedTarget,
    } as ARecordProps;

    const record = new ARecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link IARecordBuilder} for configuring a Route53 A record.
 *
 * @returns A fluent builder for a Route53 A record.
 */
export function createARecordBuilder(): IARecordBuilder {
  return Builder<ARecordBuilderProps, ARecordBuilder>(ARecordBuilder);
}
