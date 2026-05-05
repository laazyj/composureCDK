import { DsRecord, type DsRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { DS_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 DS record builder.
 *
 * Extends the CDK {@link DsRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface DsRecordBuilderProps extends Omit<DsRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link IDsRecordBuilder}.
 */
export interface DsRecordBuilderResult {
  /** The Route53 DS record construct created by the builder. */
  record: DsRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 DS record.
 *
 * DS (Delegation Signer) records establish the DNSSEC chain of trust from a
 * parent zone to a delegated child zone. Each value is a rdata string of
 * `keyTag algorithm digestType digest`.
 *
 * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec-chain-of-trust.html
 */
export type IDsRecordBuilder = ITaggedBuilder<DsRecordBuilderProps, DsRecordBuilder>;

class DsRecordBuilder implements Lifecycle<DsRecordBuilderResult> {
  props: Partial<DsRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): DsRecordBuilderResult {
    const { zone, values, ...rest } = this.props;
    if (!zone) {
      throw new Error(`DsRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`);
    }
    if (!values || values.length === 0) {
      throw new Error(
        `DsRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more DS rdata strings (keyTag algorithm digestType digest).`,
      );
    }

    const mergedProps = {
      ...DS_RECORD_DEFAULTS,
      ...rest,
      values,
      zone: resolve(zone, context),
    } as DsRecordProps;

    const record = new DsRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link IDsRecordBuilder} for configuring a Route53 DS record.
 *
 * @returns A fluent builder for a Route53 DS record.
 */
export function createDsRecordBuilder(): IDsRecordBuilder {
  return taggedBuilder<DsRecordBuilderProps, DsRecordBuilder>(DsRecordBuilder);
}
