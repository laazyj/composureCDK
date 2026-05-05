import {
  HttpsRecord,
  type HttpsRecordProps,
  type IHostedZone,
  type RecordTarget,
} from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { HTTPS_RECORD_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route53 HTTPS record builder.
 *
 * Extends the CDK {@link HttpsRecordProps} but replaces `zone` and `target`
 * with {@link Resolvable} variants so they can be wired from composed
 * components (e.g. a CloudFront distribution used as an alias target).
 */
export interface HttpsRecordBuilderProps extends Omit<HttpsRecordProps, "zone" | "target"> {
  /** The hosted zone in which to create the record. */
  zone?: Resolvable<IHostedZone>;
  /** The record target — mutually exclusive with `values`. */
  target?: Resolvable<RecordTarget>;
}

/**
 * The build output of an {@link IHttpsRecordBuilder}.
 */
export interface HttpsRecordBuilderResult {
  /** The Route53 HTTPS record construct created by the builder. */
  record: HttpsRecord;
}

/**
 * A fluent builder for configuring and creating a Route53 HTTPS record.
 *
 * HTTPS records (RFC 9460) advertise protocol hints — ALPN, port, IP hints —
 * that clients can use before opening a connection, enabling one-round-trip
 * HTTP/3 upgrades. Specify exactly one of `values` (explicit parameter list)
 * or `target` (alias, typically a CloudFront distribution).
 */
export type IHttpsRecordBuilder = ITaggedBuilder<HttpsRecordBuilderProps, HttpsRecordBuilder>;

class HttpsRecordBuilder implements Lifecycle<HttpsRecordBuilderResult> {
  props: Partial<HttpsRecordBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): HttpsRecordBuilderResult {
    const { zone, target, values, ...rest } = this.props;
    if (!zone) {
      throw new Error(
        `HttpsRecordBuilder "${id}" requires a zone. Call .zone() with an IHostedZone.`,
      );
    }
    if (values?.length === 0) {
      throw new Error(
        `HttpsRecordBuilder "${id}" requires non-empty values. ` +
          `Call .values() with one or more HttpsRecordValue entries, or use .target() instead.`,
      );
    }
    const hasValues = values !== undefined;
    if (hasValues === (target !== undefined)) {
      throw new Error(
        `HttpsRecordBuilder "${id}" requires exactly one of .values() or .target(), not both.`,
      );
    }

    const resolvedTarget = target ? resolve(target, context) : undefined;
    const isAlias = resolvedTarget?.aliasTarget !== undefined;
    const mergedProps = {
      ...(isAlias ? {} : HTTPS_RECORD_DEFAULTS),
      ...rest,
      ...(hasValues ? { values } : {}),
      ...(resolvedTarget ? { target: resolvedTarget } : {}),
      zone: resolve(zone, context),
    } as HttpsRecordProps;

    const record = new HttpsRecord(scope, id, mergedProps);
    return { record };
  }
}

/**
 * Creates a new {@link IHttpsRecordBuilder} for configuring a Route53 HTTPS
 * record.
 *
 * @returns A fluent builder for a Route53 HTTPS record.
 */
export function createHttpsRecordBuilder(): IHttpsRecordBuilder {
  return taggedBuilder<HttpsRecordBuilderProps, HttpsRecordBuilder>(HttpsRecordBuilder);
}
