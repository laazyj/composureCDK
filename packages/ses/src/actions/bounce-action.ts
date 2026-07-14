import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { Bounce, type BounceTemplate } from "aws-cdk-lib/aws-ses-actions";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { isRef, type Resolvable } from "@composurecdk/core";

/** Options for {@link bounceAction}. */
export interface BounceActionOptions {
  /** The bounce message SES returns to the sender. */
  readonly template: BounceTemplate;
  /** The email address the bounce is reported as originating from. */
  readonly sender: string;
  /** SNS topic notified when the bounce is sent. Accepts a {@link Resolvable}. */
  readonly topic?: Resolvable<ITopic>;
}

/** Rejects the received mail by returning a bounce response to the sender. */
export function bounceAction(options: BounceActionOptions): Resolvable<IReceiptRuleAction> {
  const { template, sender, topic } = options;
  const build = (resolved?: ITopic): IReceiptRuleAction =>
    new Bounce({ template, sender, ...(resolved !== undefined && { topic: resolved }) });
  if (topic === undefined) return build();
  return isRef(topic) ? topic.map(build) : build(topic);
}
