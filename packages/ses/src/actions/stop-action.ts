import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { Stop, type StopProps } from "aws-cdk-lib/aws-ses-actions";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Terminates evaluation of the rule set, optionally notifying an SNS topic
 * (which accepts a {@link Resolvable}).
 *
 * `topic` reads its type from CDK's own `StopProps.topic` rather than naming
 * `ITopic`, so it keeps tracking the installed `aws-cdk-lib` (ADR-0018).
 */
export function stopAction(
  topic?: Resolvable<NonNullable<StopProps["topic"]>>,
): Resolvable<IReceiptRuleAction> {
  const build = (resolved?: NonNullable<StopProps["topic"]>): IReceiptRuleAction =>
    new Stop(resolved !== undefined ? { topic: resolved } : undefined);
  if (topic === undefined) return build();
  return isRef(topic) ? topic.map(build) : build(topic);
}
