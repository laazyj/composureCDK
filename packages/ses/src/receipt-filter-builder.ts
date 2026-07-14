import {
  AllowListReceiptFilter,
  type AllowListReceiptFilterProps,
  ReceiptFilter,
  type ReceiptFilterProps,
} from "aws-cdk-lib/aws-ses";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { warnIfNotReceivingRegion } from "./region-support.js";

/** Configuration for the receipt filter builder — see {@link ReceiptFilterProps}. */
export type ReceiptFilterBuilderProps = ReceiptFilterProps;

/** The build output of an {@link IReceiptFilterBuilder}. */
export interface ReceiptFilterBuilderResult {
  /** The receipt filter construct. */
  receiptFilter: ReceiptFilter;
}

/**
 * A fluent builder for an SES receipt filter — an allow/block rule for a single
 * IP address or CIDR range.
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ReceiptFilter has no Tags property
export type IReceiptFilterBuilder = IBuilder<ReceiptFilterBuilderProps, ReceiptFilterBuilder>;

class ReceiptFilterBuilder implements Lifecycle<ReceiptFilterBuilderResult> {
  props: Partial<ReceiptFilterBuilderProps> = {};

  build(scope: IConstruct, id: string): ReceiptFilterBuilderResult {
    warnIfNotReceivingRegion(scope);
    return { receiptFilter: new ReceiptFilter(scope, id, { ...this.props }) };
  }
}

/** Creates a fluent builder for a single-address SES receipt filter. */
export function createReceiptFilterBuilder(): IReceiptFilterBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ReceiptFilter has no Tags property
  return Builder<ReceiptFilterBuilderProps, ReceiptFilterBuilder>(ReceiptFilterBuilder);
}

/** Configuration for the allow-list receipt filter builder. */
export type AllowListReceiptFilterBuilderProps = AllowListReceiptFilterProps;

/** The build output of an {@link IAllowListReceiptFilterBuilder}. */
export interface AllowListReceiptFilterBuilderResult {
  /** The allow-list receipt filter — blocks all IPs except the listed ones. */
  allowList: AllowListReceiptFilter;
}

/**
 * A fluent builder for an SES allow-list receipt filter — blocks all senders
 * except the supplied IPs/CIDR ranges.
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AllowListReceiptFilter is a Construct, not a taggable resource
export type IAllowListReceiptFilterBuilder = IBuilder<
  AllowListReceiptFilterBuilderProps,
  AllowListReceiptFilterBuilder
>;

class AllowListReceiptFilterBuilder implements Lifecycle<AllowListReceiptFilterBuilderResult> {
  props: Partial<AllowListReceiptFilterBuilderProps> = {};

  build(scope: IConstruct, id: string): AllowListReceiptFilterBuilderResult {
    warnIfNotReceivingRegion(scope);
    const { ips } = this.props;
    if (ips === undefined) {
      throw new Error(
        `AllowListReceiptFilterBuilder "${id}": call .ips([...]) with the addresses to allow.`,
      );
    }
    return { allowList: new AllowListReceiptFilter(scope, id, { ips }) };
  }
}

/** Creates a fluent builder for an SES allow-list receipt filter. */
export function createAllowListReceiptFilterBuilder(): IAllowListReceiptFilterBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AllowListReceiptFilter is a Construct, not a taggable resource
  return Builder<AllowListReceiptFilterBuilderProps, AllowListReceiptFilterBuilder>(
    AllowListReceiptFilterBuilder,
  );
}
