import { TxtRecord, type TxtRecordProps, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { TXT_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 TXT record builder.
 *
 * Extends the CDK {@link TxtRecordProps} but replaces `zone` with a
 * {@link Resolvable} so it can be wired from composed components.
 */
export interface TxtRecordBuilderProps extends Omit<TxtRecordProps, "zone"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
}

/**
 * The build output of an {@link ITxtRecordBuilder}.
 */
export interface TxtRecordBuilderResult {
  /** The Route53 TXT record construct created by the builder. */
  record: TxtRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 TXT record.
 *
 * Commonly used for SPF, DKIM, DMARC, and domain-verification tokens.
 */
export type ITxtRecordBuilder = IBuilder<TxtRecordBuilderProps, TxtRecordBuilder>;

class TxtRecordBuilder implements Lifecycle<TxtRecordBuilderResult> {
  props: Partial<TxtRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): TxtRecordBuilderResult {
    const { zone, values, ...rest } = this.props;
    if (!zone) {
      throw new Error(
        `TxtRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`,
      );
    }
    if (!values || values.length === 0) {
      throw new Error(
        `TxtRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more TXT record strings.`,
      );
    }

    const mergedProps = {
      ...TXT_RECORD_DEFAULTS,
      ...rest,
      values,
      zone: resolve(zone, context),
    } as TxtRecordProps;

    const record = new TxtRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link ITxtRecordBuilder} for configuring a Route53 TXT record.
 *
 * @returns A fluent builder for a Route53 TXT record.
 */
export function createTxtRecordBuilder(): ITxtRecordBuilder {
  return Builder<TxtRecordBuilderProps, TxtRecordBuilder>(TxtRecordBuilder);
}
