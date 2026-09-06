import type { IRuleTarget } from "aws-cdk-lib/aws-events";
import { SnsTopic, type SnsTopicProps } from "aws-cdk-lib/aws-events-targets";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Wraps an SNS topic as an EventBridge {@link IRuleTarget}, deferring
 * resolution if the topic is a {@link Ref} to a sibling component's output.
 *
 * Mirrors the {@link SnsTopic} target from `aws-events-targets` — `props`
 * accepts {@link SnsTopicProps.message} for input transformation, and the
 * IAM `role` / `authorizeUsingRole` options for cross-account publishing.
 *
 * Note: SNS targets do not accept a per-target DLQ
 * ({@link SnsTopicProps} does not extend the retry/DLQ base type).
 *
 * The accepted type is read from CDK's own target constructor rather than
 * named as `ITopic`, so it keeps tracking the installed `aws-cdk-lib` as CDK
 * migrates its target constructors to the broader `*Ref` interfaces
 * (ADR-0018).
 */
export function snsTarget(
  topic: Resolvable<ConstructorParameters<typeof SnsTopic>[0]>,
  props?: SnsTopicProps,
): Resolvable<IRuleTarget> {
  if (isRef(topic)) return topic.map((resolved) => new SnsTopic(resolved, props));
  return new SnsTopic(topic, props);
}
