import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { type EmailEncoding, Sns } from "aws-cdk-lib/aws-ses-actions";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { isRef, type Resolvable } from "@composurecdk/core";

/** Options for {@link snsAction}. */
export interface SnsActionOptions {
  /**
   * Encoding SES uses for the message published to the topic. Defaults to SES's
   * default, UTF-8, when unset.
   */
  readonly encoding?: EmailEncoding;
}

/**
 * Publishes the received mail to an SNS topic. The topic accepts a
 * {@link Resolvable}, so it can wire to a sibling component via `ref()`.
 */
export function snsAction(
  topic: Resolvable<ITopic>,
  options: SnsActionOptions = {},
): Resolvable<IReceiptRuleAction> {
  const build = (resolved: ITopic): IReceiptRuleAction =>
    new Sns({
      topic: resolved,
      ...(options.encoding !== undefined && { encoding: options.encoding }),
    });
  return isRef(topic) ? topic.map(build) : build(topic);
}
