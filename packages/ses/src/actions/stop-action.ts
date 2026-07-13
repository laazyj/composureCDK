import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { Stop } from "aws-cdk-lib/aws-ses-actions";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Terminates evaluation of the rule set, optionally notifying an SNS topic
 * (which accepts a {@link Resolvable}).
 */
export function stopAction(topic?: Resolvable<ITopic>): Resolvable<IReceiptRuleAction> {
  const build = (resolved?: ITopic): IReceiptRuleAction =>
    new Stop(resolved !== undefined ? { topic: resolved } : undefined);
  if (topic === undefined) return build();
  return isRef(topic) ? topic.map(build) : build(topic);
}
