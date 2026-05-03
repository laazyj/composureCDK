import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { resolve, type Resolvable } from "@composurecdk/core";
import type { Email } from "./email.js";

/**
 * Subscribers attached to a budget notification.
 *
 * AWS Budgets enforces an asymmetric per-notification subscriber rule
 * that CloudFormation does not model:
 *
 * - up to 10 subscribers per notification
 * - **at most one** with `SubscriptionType=SNS`
 * - the remainder must be `EMAIL`
 *
 * This shape encodes that constraint in the type system: `sns` is
 * singular, so passing two SNS topics is unrepresentable. The
 * combined-count cap is enforced at synth time.
 *
 * @see https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_NotificationWithSubscribers.html
 */
export interface NotifySubscribers {
  /**
   * Optional SNS topic to publish notifications to. AWS Budgets allows
   * at most one SNS subscriber per notification; route fan-out by
   * adding additional subscriptions to this single topic.
   */
  sns?: ITopic | Resolvable<ITopic>;
  /**
   * Optional list of validated email addresses. Construct each value
   * via {@link email}; bare strings are rejected at compile time. The
   * combined `sns` + `emails` count must be ≤ 10.
   */
  emails?: Email[];
}

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
  subscribers: NotifySubscribers;
  comparisonOperator?: "GREATER_THAN" | "LESS_THAN" | "EQUAL_TO";
  thresholdType?: "PERCENTAGE" | "ABSOLUTE_VALUE";
}

/**
 * Resolved subscribers in the CloudFormation shape required by
 * `AWS::Budgets::Budget`, plus any SNS topic referenced (so the caller
 * can create matching `AWS::SNS::TopicPolicy` grants).
 */
export interface ResolvedSubscribers {
  cfn: CfnBudget.SubscriberProperty[];
  snsTopics: ITopic[];
}

/**
 * Resolve a {@link NotifySubscribers} into the CloudFormation shape for
 * `AWS::Budgets::Budget`'s `Subscribers` array, plus any SNS topic
 * referenced so the caller can create a matching topic policy.
 *
 * The SNS subscriber (if any) is emitted first, followed by emails in
 * declaration order — the order is not load-bearing, but stable output
 * keeps test snapshots steady.
 */
export function resolveSubscribers(
  subscribers: NotifySubscribers,
  context: Record<string, object>,
): ResolvedSubscribers {
  const cfn: CfnBudget.SubscriberProperty[] = [];
  const snsTopics: ITopic[] = [];

  if (subscribers.sns !== undefined) {
    const topic = resolve(subscribers.sns, context);
    cfn.push({ address: topic.topicArn, subscriptionType: "SNS" });
    snsTopics.push(topic);
  }

  for (const address of subscribers.emails ?? []) {
    cfn.push({ address, subscriptionType: "EMAIL" });
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
