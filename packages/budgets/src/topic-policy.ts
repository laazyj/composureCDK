import { Annotations, CfnResource, RemovalPolicy } from "aws-cdk-lib";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnTopicPolicy, type ITopic, TopicPolicy } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";

/** Whether `x` is a `TopicPolicy` L2, by its L1's resource type (ADR-0011). */
function isTopicPolicy(x: unknown): x is TopicPolicy {
  const cfn = (x as IConstruct | undefined)?.node.defaultChild;
  return (
    CfnResource.isCfnResource(cfn) && cfn.cfnResourceType === CfnTopicPolicy.CFN_RESOURCE_TYPE_NAME
  );
}

/**
 * Grant the AWS Budgets service principal (`budgets.amazonaws.com`)
 * permission to publish to each of the supplied topics, by adding the
 * statement to each topic's own access policy.
 *
 * Returns the `TopicPolicy` constructs this creates, keyed by the topic's
 * fully-qualified CDK node path: a retained transitional policy sharing the
 * topic's own document, or — for an imported topic, whose policy CDK cannot
 * add to — a standalone policy. The package README's "Automatic SNS Topic
 * Policies" section explains both.
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
    // The logical id earlier versions gave their separate Budgets-only policy.
    const policyId = `${id}TopicPolicy${topic.node.addr}`;
    const { statementAdded, policyDependable } = topic.addToResourcePolicy(statement);

    if (!statementAdded) {
      const policy = new TopicPolicy(scope, policyId, { topics: [topic] });
      policy.document.addStatements(statement);
      Annotations.of(policy).addWarningV2(
        "@composurecdk/budgets:imported-topic-policy",
        `SNS topic ${key} was not created in this app, so its access policy cannot be added to. ` +
          `This TopicPolicy grants budgets.amazonaws.com SNS:Publish and replaces the topic's ` +
          `existing policy.`,
      );
      policies[key] = policy;
    } else if (isTopicPolicy(policyDependable)) {
      const policy = new TopicPolicy(scope, policyId, {
        topics: [topic],
        policyDocument: policyDependable.document,
      });
      policy.applyRemovalPolicy(RemovalPolicy.RETAIN);
      policies[key] = policy;
    } else {
      Annotations.of(scope).addWarningV2(
        "@composurecdk/budgets:topic-policy-not-found",
        `Could not find the access policy of SNS topic ${key}, so no transitional policy was ` +
          `created at ${policyId}. If an earlier version deployed one there, removing it will ` +
          `reset the topic's policy.`,
      );
    }
  }

  return policies;
}
