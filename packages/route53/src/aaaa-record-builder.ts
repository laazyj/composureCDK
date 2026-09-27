import { AaaaRecord, type AaaaRecordProps } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { AAAA_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 AAAA (IPv6) record builder.
 *
 * Extends the CDK {@link AaaaRecordProps} but replaces `zone` and `target`
 * with {@link Resolvable} variants so they can be wired from other components
 * in a composed system.
 *
 * Both read their inner type from CDK's own prop rather than naming
 * `IHostedZone` / `RecordTarget`, so they keep tracking the installed
 * `aws-cdk-lib` (ADR-0018).
 */
export interface AaaaRecordBuilderProps extends Omit<AaaaRecordProps, "zone" | "target"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<NonNullable<AaaaRecordProps["zone"]>>;
  /** The record target. */
  target?: Resolvable<NonNullable<AaaaRecordProps["target"]>>;
}

/**
 * The build output of an {@link IAaaaRecordBuilder}.
 */
export interface AaaaRecordBuilderResult {
  /** The Route53 AAAA record construct created by the builder. */
  record: AaaaRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 AAAA (IPv6) record.
 *
 * Use this alongside an A record to expose a CloudFront distribution or ALB
 * over both IPv4 and IPv6 — AWS alias targets support both families from a
 * single resource.
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::Route53::RecordSet has no Tags property
export type IAaaaRecordBuilder = IBuilder<AaaaRecordBuilderProps, AaaaRecordBuilder>;

class AaaaRecordBuilder implements Lifecycle<AaaaRecordBuilderResult> {
  props: Partial<AaaaRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): AaaaRecordBuilderResult {
    const { zone, target, ...rest } = this.props;
    if (!zone) {
      throw new Error(
        `AaaaRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`,
      );
    }
    if (!target) {
      throw new Error(
        `AaaaRecordBuilder "${id}" requires a target. Call .target() with a RecordTarget.`,
      );
    }

    const resolvedTarget = resolve(target, context);
    const isAlias = resolvedTarget.aliasTarget !== undefined;
    const mergedProps = {
      ...(isAlias ? {} : AAAA_RECORD_DEFAULTS),
      ...rest,
      zone: resolve(zone, context),
      target: resolvedTarget,
    } as AaaaRecordProps;

    const record = new AaaaRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link IAaaaRecordBuilder} for configuring a Route53 AAAA
 * (IPv6) record.
 *
 * @returns A fluent builder for a Route53 AAAA record.
 */
export function createAaaaRecordBuilder(): IAaaaRecordBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::Route53::RecordSet has no Tags property
  return Builder<AaaaRecordBuilderProps, AaaaRecordBuilder>(AaaaRecordBuilder);
}
