import { CaaRecord, type CaaRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { CAA_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 CAA record builder.
 *
 * Extends the CDK {@link CaaRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface CaaRecordBuilderProps extends Omit<CaaRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link ICaaRecordBuilder}.
 */
export interface CaaRecordBuilderResult {
  /** The Route53 CAA record construct created by the builder. */
  record: CaaRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 CAA record.
 *
 * CAA records restrict which certificate authorities may issue certificates
 * for the domain — a CA that does not match any permitted `issue` / `issuewild`
 * entry must refuse to issue. When issuing via ACM, see
 * `createCaaAmazonRecordBuilder` (not yet implemented — use a CAA record with
 * `amazon.com` / `amazontrust.com` / `awstrust.com` / `amazonaws.com` values).
 *
 * @see https://docs.aws.amazon.com/acm/latest/userguide/setup-caa.html
 */
export type ICaaRecordBuilder = ITaggedBuilder<CaaRecordBuilderProps, CaaRecordBuilder>;

class CaaRecordBuilder implements Lifecycle<CaaRecordBuilderResult> {
  props: Partial<CaaRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): CaaRecordBuilderResult {
    const { zone, values, ...rest } = this.props;
    if (!zone) {
      throw new Error(
        `CaaRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`,
      );
    }
    if (!values || values.length === 0) {
      throw new Error(
        `CaaRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more { flag, tag, value } entries.`,
      );
    }

    const mergedProps = {
      ...CAA_RECORD_DEFAULTS,
      ...rest,
      values,
      zone: resolve(zone, context),
    } as CaaRecordProps;

    const record = new CaaRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link ICaaRecordBuilder} for configuring a Route53 CAA record.
 *
 * @returns A fluent builder for a Route53 CAA record.
 */
export function createCaaRecordBuilder(): ICaaRecordBuilder {
  return taggedBuilder<CaaRecordBuilderProps, CaaRecordBuilder>(CaaRecordBuilder);
}
