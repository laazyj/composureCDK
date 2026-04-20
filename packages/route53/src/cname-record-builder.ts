import { CnameRecord, type CnameRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { CNAME_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 CNAME record builder.
 *
 * Extends the CDK {@link CnameRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface CnameRecordBuilderProps extends Omit<CnameRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link ICnameRecordBuilder}.
 */
export interface CnameRecordBuilderResult {
  /** The Route53 CNAME record construct created by the builder. */
  record: CnameRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 CNAME record.
 *
 * Prefer {@link createARecordBuilder | A / AAAA alias records} when pointing
 * at AWS resources — alias records are free, resolve in one hop, and can be
 * used at the apex. Use CNAME for non-AWS targets or for sub-domain
 * redirections where an alias is not available.
 */
export type ICnameRecordBuilder = IBuilder<CnameRecordBuilderProps, CnameRecordBuilder>;

class CnameRecordBuilder implements Lifecycle<CnameRecordBuilderResult> {
  props: Partial<CnameRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): CnameRecordBuilderResult {
    const { zone, domainName, recordName, ...rest } = this.props;
    if (!zone) {
      throw new Error(
        `CnameRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`,
      );
    }
    if (!domainName) {
      throw new Error(
        `CnameRecordBuilder "${id}" requires a domainName. ` +
          `Call .domainName() with the target host (what the CNAME points to).`,
      );
    }
    if (!recordName) {
      throw new Error(
        `CnameRecordBuilder "${id}" requires a recordName. ` +
          `Call .recordName() with the subdomain — CNAME records cannot be at the zone apex.`,
      );
    }

    const mergedProps = {
      ...CNAME_RECORD_DEFAULTS,
      ...rest,
      domainName,
      recordName,
      zone: resolve(zone, context),
    } as CnameRecordProps;

    const record = new CnameRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link ICnameRecordBuilder} for configuring a Route53 CNAME
 * record.
 *
 * @returns A fluent builder for a Route53 CNAME record.
 */
export function createCnameRecordBuilder(): ICnameRecordBuilder {
  return Builder<CnameRecordBuilderProps, CnameRecordBuilder>(CnameRecordBuilder);
}
