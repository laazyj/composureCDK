import type { IRuleTarget } from "aws-cdk-lib/aws-events";
import { CloudWatchLogGroup, type LogGroupProps } from "aws-cdk-lib/aws-events-targets";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Wraps a CloudWatch log group as an EventBridge {@link IRuleTarget},
 * deferring resolution if the log group is a {@link Ref} to a sibling
 * component's output.
 *
 * Mirrors the {@link CloudWatchLogGroup} target from `aws-events-targets`,
 * useful for audit / debug logging. `props` accepts
 * {@link LogGroupProps.logEvent} (preferred over the deprecated `event`)
 * to control the log payload, plus the inherited DLQ/retry options.
 *
 * The accepted type is read from CDK's own target constructor rather than
 * named as `ILogGroup`, so it keeps tracking it: CDK already takes the broader
 * `logs.ILogGroupRef` here, which the pinned interface was rejecting
 * (ADR-0018).
 */
export function cloudWatchLogGroupTarget(
  logGroup: Resolvable<ConstructorParameters<typeof CloudWatchLogGroup>[0]>,
  props?: LogGroupProps,
): Resolvable<IRuleTarget> {
  if (isRef(logGroup)) {
    return logGroup.map((resolved) => new CloudWatchLogGroup(resolved, props));
  }
  return new CloudWatchLogGroup(logGroup, props);
}
