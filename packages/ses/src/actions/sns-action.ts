import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { Sns, type SnsProps } from "aws-cdk-lib/aws-ses-actions";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Options for {@link snsAction} — every CDK {@link SnsProps} field except
 * `topic`, which is the helper's positional argument.
 */
export type SnsActionOptions = Omit<SnsProps, "topic">;

/**
 * Publishes the received mail to an SNS topic. The topic accepts a
 * {@link Resolvable}, so it can wire to a sibling component via `ref()`.
 *
 * `topic` reads its type from CDK's own `SnsProps.topic` rather than naming
 * `ITopic`, so it keeps tracking the installed `aws-cdk-lib` (ADR-0018).
 */
export function snsAction(
  topic: Resolvable<SnsProps["topic"]>,
  options: SnsActionOptions = {},
): Resolvable<IReceiptRuleAction> {
  const build = (resolved: SnsProps["topic"]): IReceiptRuleAction =>
    new Sns({
      topic: resolved,
      ...(options.encoding !== undefined && { encoding: options.encoding }),
    });
  return isRef(topic) ? topic.map(build) : build(topic);
}
