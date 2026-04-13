import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type ITopic, TopicPolicy } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";

/**
 * Create an `AWS::SNS::TopicPolicy` granting the AWS Budgets service
 * principal (`budgets.amazonaws.com`) permission to publish to each of
 * the supplied topics.
 *
 * Without this policy, a budget notification configured with an SNS
 * subscriber will silently fail to deliver — one of the most common
 * footguns when wiring Budgets to SNS by hand. The builder wires it up
 * automatically whenever at least one `SNS` subscriber is configured.
 *
 * Each topic gets its own `TopicPolicy` construct, keyed by the topic's
 * CDK node id, so callers can inspect or extend them via the build
 * result.
 *
 * @see https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html
 */
export function createBudgetsTopicPolicies(
  scope: IConstruct,
  id: string,
  topics: ITopic[],
): Record<string, TopicPolicy> {
  const policies: Record<string, TopicPolicy> = {};
  const seen = new Set<string>();

  for (const topic of topics) {
    const key = topic.node.id;
    if (seen.has(key)) continue;
    seen.add(key);

    const policy = new TopicPolicy(scope, `${id}TopicPolicy${key}`, {
      topics: [topic],
      policyDocument: undefined,
    });
    policy.document.addStatements(
      new PolicyStatement({
        sid: "AllowBudgetsPublish",
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("budgets.amazonaws.com")],
        actions: ["SNS:Publish"],
        resources: [topic.topicArn],
      }),
    );

    policies[key] = policy;
  }

  return policies;
}
