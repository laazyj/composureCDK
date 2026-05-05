import { SrvRecord, type SrvRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { SRV_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 SRV record builder.
 *
 * Extends the CDK {@link SrvRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface SrvRecordBuilderProps extends Omit<SrvRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link ISrvRecordBuilder}.
 */
export interface SrvRecordBuilderResult {
  /** The Route53 SRV record construct created by the builder. */
  record: SrvRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 SRV record.
 *
 * SRV records advertise the location (host + port) of a named service, and
 * the record name typically follows the `_service._proto` convention (e.g.
 * `_sip._tcp`). Lower priority wins; weight distributes load across peers.
 */
export type ISrvRecordBuilder = ITaggedBuilder<SrvRecordBuilderProps, SrvRecordBuilder>;

class SrvRecordBuilder implements Lifecycle<SrvRecordBuilderResult> {
  props: Partial<SrvRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): SrvRecordBuilderResult {
    const { zone, values, ...rest } = this.props;
    if (!zone) {
      throw new Error(
        `SrvRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`,
      );
    }
    if (!values || values.length === 0) {
      throw new Error(
        `SrvRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more { priority, weight, port, hostName } entries.`,
      );
    }

    const mergedProps = {
      ...SRV_RECORD_DEFAULTS,
      ...rest,
      values,
      zone: resolve(zone, context),
    } as SrvRecordProps;

    const record = new SrvRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link ISrvRecordBuilder} for configuring a Route53 SRV record.
 *
 * @returns A fluent builder for a Route53 SRV record.
 */
export function createSrvRecordBuilder(): ISrvRecordBuilder {
  return taggedBuilder<SrvRecordBuilderProps, SrvRecordBuilder>(SrvRecordBuilder);
}
