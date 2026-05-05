import { MxRecord, type MxRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { MX_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 MX record builder.
 *
 * Extends the CDK {@link MxRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface MxRecordBuilderProps extends Omit<MxRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link IMxRecordBuilder}.
 */
export interface MxRecordBuilderResult {
  /** The Route53 MX record construct created by the builder. */
  record: MxRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 MX record.
 *
 * MX records direct inbound mail to the host(s) responsible for accepting it.
 * Each value pairs a priority (lower wins) with a fully-qualified mail-server
 * host name. Pair with SPF/DKIM/DMARC TXT records for authenticated email.
 */
export type IMxRecordBuilder = ITaggedBuilder<MxRecordBuilderProps, MxRecordBuilder>;

class MxRecordBuilder implements Lifecycle<MxRecordBuilderResult> {
  props: Partial<MxRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): MxRecordBuilderResult {
    const { zone, values, ...rest } = this.props;
    if (!zone) {
      throw new Error(`MxRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`);
    }
    if (!values || values.length === 0) {
      throw new Error(
        `MxRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more { priority, hostName } entries.`,
      );
    }

    const mergedProps = {
      ...MX_RECORD_DEFAULTS,
      ...rest,
      values,
      zone: resolve(zone, context),
    } as MxRecordProps;

    const record = new MxRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link IMxRecordBuilder} for configuring a Route53 MX record.
 *
 * @returns A fluent builder for a Route53 MX record.
 */
export function createMxRecordBuilder(): IMxRecordBuilder {
  return taggedBuilder<MxRecordBuilderProps, MxRecordBuilder>(MxRecordBuilder);
}
