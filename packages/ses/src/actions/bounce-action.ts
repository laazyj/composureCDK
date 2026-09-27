import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { Bounce, type BounceProps } from "aws-cdk-lib/aws-ses-actions";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Options for {@link bounceAction} — every CDK {@link BounceProps} field, with
 * `topic` widened to a {@link Resolvable}.
 *
 * `topic` reads its inner type from CDK's own prop rather than naming
 * `ITopic`, so it keeps tracking the installed `aws-cdk-lib` (ADR-0018).
 */
export interface BounceActionOptions extends Omit<BounceProps, "topic"> {
  /** SNS topic notified when the bounce is sent. Accepts a {@link Resolvable}. */
  readonly topic?: Resolvable<NonNullable<BounceProps["topic"]>>;
}

/** Rejects the received mail by returning a bounce response to the sender. */
export function bounceAction(options: BounceActionOptions): Resolvable<IReceiptRuleAction> {
  const { template, sender, topic } = options;
  const build = (resolved?: NonNullable<BounceProps["topic"]>): IReceiptRuleAction =>
    new Bounce({ template, sender, ...(resolved !== undefined && { topic: resolved }) });
  if (topic === undefined) return build();
  return isRef(topic) ? topic.map(build) : build(topic);
}
