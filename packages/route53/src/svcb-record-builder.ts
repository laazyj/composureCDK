import { SvcbRecord, type SvcbRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { SVCB_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 SVCB record builder.
 *
 * Extends the CDK {@link SvcbRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface SvcbRecordBuilderProps extends Omit<SvcbRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link ISvcbRecordBuilder}.
 */
export interface SvcbRecordBuilderResult {
  /** The Route53 SVCB record construct created by the builder. */
  record: SvcbRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 SVCB record.
 *
 * SVCB is the generic service-binding record type (RFC 9460). For HTTPS
 * specifically, prefer {@link createHttpsRecordBuilder} — most clients only
 * consult HTTPS records for web traffic.
 */
export type ISvcbRecordBuilder = ITaggedBuilder<SvcbRecordBuilderProps, SvcbRecordBuilder>;

class SvcbRecordBuilder implements Lifecycle<SvcbRecordBuilderResult> {
  props: Partial<SvcbRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): SvcbRecordBuilderResult {
    const { zone, values, ...rest } = this.props;
    if (!zone) {
      throw new Error(
        `SvcbRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`,
      );
    }
    if (!values || values.length === 0) {
      throw new Error(
        `SvcbRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more SvcbRecordValue entries.`,
      );
    }

    const mergedProps = {
      ...SVCB_RECORD_DEFAULTS,
      ...rest,
      values,
      zone: resolve(zone, context),
    } as SvcbRecordProps;

    const record = new SvcbRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link ISvcbRecordBuilder} for configuring a Route53 SVCB
 * record.
 *
 * @returns A fluent builder for a Route53 SVCB record.
 */
export function createSvcbRecordBuilder(): ISvcbRecordBuilder {
  return taggedBuilder<SvcbRecordBuilderProps, SvcbRecordBuilder>(SvcbRecordBuilder);
}
