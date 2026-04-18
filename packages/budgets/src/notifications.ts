import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { resolve, type Resolvable } from "@composurecdk/core";

/**
 * A subscriber that receives budget notifications. Either an email
 * address (string) or an SNS topic (concrete or resolvable reference).
 */
export type BudgetSubscriber = string | ITopic | Resolvable<ITopic>;

/**
 * Which side of spend a notification triggers on.
 *
 * - `ACTUAL` — fires when real, posted spend crosses the threshold.
 * - `FORECASTED` — fires when AWS projects you will cross the threshold
 *   during the current budget period.
 */
export type NotificationType = "ACTUAL" | "FORECASTED";

/**
 * Raw notification entry accepted by {@link IBudgetBuilder.addNotification}.
 *
 * Callers that need the full CloudFormation surface (custom comparison
 * operators, absolute-value thresholds) should use this shape; for the
 * common percentage case, prefer
 * {@link IBudgetBuilder.notifyOnActual} /
 * {@link IBudgetBuilder.notifyOnForecasted}.
 */
export interface NotificationEntry {
  notificationType: NotificationType;
  /**
   * Threshold value. Interpreted as a percentage of the budget limit
   * when `thresholdType` is `PERCENTAGE` (the default), or as an
   * absolute amount when `thresholdType` is `ABSOLUTE_VALUE`.
   */
  threshold: number;
  subscribers: BudgetSubscriber[];
  comparisonOperator?: "GREATER_THAN" | "LESS_THAN" | "EQUAL_TO";
  thresholdType?: "PERCENTAGE" | "ABSOLUTE_VALUE";
}

/**
 * Resolved subscriber after any {@link Resolvable} has been resolved.
 *
 * `snsTopics` is surfaced separately so the builder can create
 * `AWS::SNS::TopicPolicy` entries granting `budgets.amazonaws.com`
 * permission to publish.
 */
export interface ResolvedSubscribers {
  cfn: CfnBudget.SubscriberProperty[];
  snsTopics: ITopic[];
}

/**
 * Resolve a list of {@link BudgetSubscriber}s into the CloudFormation
 * shape required by `AWS::Budgets::Budget` and a flat list of any SNS
 * topics referenced (so the caller can create topic policies).
 */
export function resolveSubscribers(
  subscribers: BudgetSubscriber[],
  context: Record<string, object>,
): ResolvedSubscribers {
  const cfn: CfnBudget.SubscriberProperty[] = [];
  const snsTopics: ITopic[] = [];

  for (const subscriber of subscribers) {
    if (typeof subscriber === "string") {
      cfn.push({ address: subscriber, subscriptionType: "EMAIL" });
      continue;
    }

    const topic = resolve(subscriber, context);
    cfn.push({ address: topic.topicArn, subscriptionType: "SNS" });
    snsTopics.push(topic);
  }

  return { cfn, snsTopics };
}

/**
 * Convert a {@link NotificationEntry} plus resolved subscribers into the
 * CloudFormation `NotificationWithSubscribersProperty` shape.
 */
export function toCfnNotificationWithSubscribers(
  entry: NotificationEntry,
  resolvedSubscribers: CfnBudget.SubscriberProperty[],
): CfnBudget.NotificationWithSubscribersProperty {
  return {
    notification: {
      notificationType: entry.notificationType,
      threshold: entry.threshold,
      comparisonOperator: entry.comparisonOperator ?? "GREATER_THAN",
      thresholdType: entry.thresholdType ?? "PERCENTAGE",
    },
    subscribers: resolvedSubscribers,
  };
}
