import { NsRecord, type NsRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { NS_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 NS record builder.
 *
 * Extends the CDK {@link NsRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface NsRecordBuilderProps extends Omit<NsRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link INsRecordBuilder}.
 */
export interface NsRecordBuilderResult {
  /** The Route53 NS record construct created by the builder. */
  record: NsRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 NS record.
 *
 * Use NS records to delegate a subdomain to a different set of name servers
 * (including another Route53 hosted zone). The apex NS record set is managed
 * by Route53 itself and should not be recreated here.
 */
export type INsRecordBuilder = IBuilder<NsRecordBuilderProps, NsRecordBuilder>;

class NsRecordBuilder implements Lifecycle<NsRecordBuilderResult> {
  props: Partial<NsRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): NsRecordBuilderResult {
    const { zone, values, recordName, ...rest } = this.props;
    if (!zone) {
      throw new Error(`NsRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`);
    }
    if (!recordName) {
      throw new Error(
        `NsRecordBuilder "${id}" requires a recordName. ` +
          `Call .recordName() with the delegated subdomain — the apex NS set is managed by Route53.`,
      );
    }
    if (!values || values.length === 0) {
      throw new Error(
        `NsRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more fully-qualified name-server host names.`,
      );
    }

    const mergedProps = {
      ...NS_RECORD_DEFAULTS,
      ...rest,
      recordName,
      values,
      zone: resolve(zone, context),
    } as NsRecordProps;

    const record = new NsRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link INsRecordBuilder} for configuring a Route53 NS record.
 *
 * @returns A fluent builder for a Route53 NS record.
 */
export function createNsRecordBuilder(): INsRecordBuilder {
  return Builder<NsRecordBuilderProps, NsRecordBuilder>(NsRecordBuilder);
}
