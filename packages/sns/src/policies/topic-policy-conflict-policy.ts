import { Annotations, Aspects, CfnResource, Stack, Token } from "aws-cdk-lib";
import { CfnTopicInlinePolicy, CfnTopicPolicy } from "aws-cdk-lib/aws-sns";
import { type IConstruct } from "constructs";

/**
 * The warning id `warn` mode annotates with. Pass it to
 * `Annotations.of(scope).acknowledgeWarning(...)` to silence a known case.
 */
export const TOPIC_POLICY_CONFLICT_WARNING_ID = "@composurecdk/sns:topic-policy-conflict";

/** Configuration for {@link topicPolicyConflictPolicy}. */
export interface TopicPolicyConflictPolicyConfig {
  /**
   * `throw` fails synth at the first conflict; `warn` annotates every
   * conflict and carries on.
   *
   * @default "throw"
   */
  onViolation?: "throw" | "warn";
}

/**
 * The topics a topic-policy resource writes to, keyed so two references to
 * one topic compare equal, or `undefined` for any other node. Detected by
 * resource-type string rather than `instanceof`, which fails across realms.
 */
function targetsOf(node: IConstruct): string[] | undefined {
  if (!CfnResource.isCfnResource(node)) return undefined;

  let topics: unknown;
  if (node.cfnResourceType === CfnTopicPolicy.CFN_RESOURCE_TYPE_NAME) {
    topics = (node as CfnTopicPolicy).topics;
  } else if (node.cfnResourceType === CfnTopicInlinePolicy.CFN_RESOURCE_TYPE_NAME) {
    topics = [(node as CfnTopicInlinePolicy).topicArn];
  } else {
    return undefined;
  }

  const stack = Stack.of(node);
  const resolved: unknown = stack.resolve(topics);
  if (!Array.isArray(resolved)) return undefined;

  // A literal ARN names the same topic from any stack; an intrinsic (`Ref`,
  // `Fn::ImportValue`) only means something inside the stack it resolves in.
  const stackPath = stack.node.path;
  return resolved.map((topic: unknown) =>
    typeof topic === "string" && !Token.isUnresolved(topic)
      ? topic
      : `${stackPath}:${JSON.stringify(topic)}`,
  );
}

/**
 * Fails synth when more than one `AWS::SNS::TopicPolicy` or
 * `AWS::SNS::TopicInlinePolicy` targets the same SNS topic. Each replaces the
 * topic's single access policy, so the last one CloudFormation applies wins
 * and nothing reports it. See the package README for the full rationale.
 *
 * Installs a CDK Aspect; call it once on any scope before `app.synth()`.
 *
 * @example
 * ```ts
 * topicPolicyConflictPolicy(app);
 * ```
 */
export function topicPolicyConflictPolicy(
  scope: IConstruct,
  config: TopicPolicyConflictPolicyConfig = {},
): void {
  const { onViolation = "throw" } = config;
  const claims = new Map<string, IConstruct>();

  Aspects.of(scope).add({
    visit(node: IConstruct): void {
      const keys = targetsOf(node);
      if (keys === undefined) return;

      for (const key of keys) {
        const prior = claims.get(key);
        if (prior === undefined) {
          claims.set(key, node);
          continue;
        }
        if (prior === node) continue;

        const message =
          `${node.node.path}: another topic policy (${prior.node.path}) already targets ` +
          `SNS topic ${key}, and whichever CloudFormation applies last replaces the other. ` +
          `Add statements with topic.addToResourcePolicy(...) instead.`;
        if (onViolation === "throw") throw new Error(message);
        Annotations.of(node).addWarningV2(TOPIC_POLICY_CONFLICT_WARNING_ID, message);
      }
    },
  });
}
