import { Annotations } from "aws-cdk-lib";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type ITopic, TopicPolicy } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";

/**
 * Grant the AWS Budgets service principal (`budgets.amazonaws.com`)
 * permission to publish to each of the supplied topics, by adding the
 * statement to each topic's own access policy.
 *
 * Returns the `TopicPolicy` constructs this creates, keyed by the topic's
 * fully-qualified CDK node path. Only an imported topic, whose policy CDK
 * cannot add to, gets one: a standalone policy granting just this statement.
 * The package README's "Automatic SNS Topic Policies" section explains why.
 *
 * @see https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html
 */
export function createBudgetsTopicPolicies(
  scope: IConstruct,
  id: string,
  topics: ITopic[],
): Record<string, TopicPolicy> {
  const policies: Record<string, TopicPolicy> = {};

  for (const topic of topics) {
    const key = topic.node.path;
    if (key in policies) continue;

    const statement = new PolicyStatement({
      sid: "AllowBudgetsPublish",
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal("budgets.amazonaws.com")],
      actions: ["SNS:Publish"],
      resources: [topic.topicArn],
    });
    if (!topic.addToResourcePolicy(statement).statementAdded) {
      // The logical id earlier versions gave every Budgets-only policy.
      const policy = new TopicPolicy(scope, `${id}TopicPolicy${topic.node.addr}`, {
        topics: [topic],
      });
      policy.document.addStatements(statement);
      Annotations.of(policy).addWarningV2(
        "@composurecdk/budgets:imported-topic-policy",
        `SNS topic ${key} was not created in this app, so its access policy cannot be added to. ` +
          `This TopicPolicy grants budgets.amazonaws.com SNS:Publish and replaces the topic's ` +
          `existing policy. Set topicPolicy(false) to manage the topic's policy yourself.`,
      );
      policies[key] = policy;
    }
  }

  return policies;
}
