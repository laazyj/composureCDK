import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnTopicInlinePolicy, type ITopic, Topic, TopicPolicy } from "aws-cdk-lib/aws-sns";
import {
  TOPIC_POLICY_CONFLICT_WARNING_ID,
  topicPolicyConflictPolicy,
} from "../src/policies/topic-policy-conflict-policy.js";

const IMPORTED_ARN = "arn:aws:sns:us-east-1:123456789012:alerts";

function publishStatement(topic: ITopic): PolicyStatement {
  return new PolicyStatement({
    effect: Effect.ALLOW,
    principals: [new ServicePrincipal("budgets.amazonaws.com")],
    actions: ["sns:Publish"],
    resources: [topic.topicArn],
  });
}

function standalonePolicy(stack: Stack, id: string, topic: ITopic): TopicPolicy {
  const policy = new TopicPolicy(stack, id, { topics: [topic] });
  policy.document.addStatements(publishStatement(topic));
  return policy;
}

describe("topicPolicyConflictPolicy", () => {
  it("passes a topic whose statements all live in its own policy", () => {
    const app = new App();
    const stack = new Stack(app, "Stack");
    const topic = new Topic(stack, "Alerts", { enforceSSL: true });
    topic.addToResourcePolicy(publishStatement(topic));
    topicPolicyConflictPolicy(app);

    expect(() => Template.fromStack(stack)).not.toThrow();
  });

  it("throws when a standalone TopicPolicy targets a topic that has its own", () => {
    const app = new App();
    const stack = new Stack(app, "Stack");
    const topic = new Topic(stack, "Alerts", { enforceSSL: true });
    standalonePolicy(stack, "Extra", topic);
    topicPolicyConflictPolicy(app);

    expect(() => Template.fromStack(stack)).toThrow(
      /Stack\/Extra\/Resource: another topic policy \(Stack\/Alerts\/Policy\/Resource\)/,
    );
  });

  it("throws when two standalone policies target the same topic", () => {
    const app = new App();
    const stack = new Stack(app, "Stack");
    const topic = new Topic(stack, "Alerts");
    standalonePolicy(stack, "First", topic);
    standalonePolicy(stack, "Second", topic);
    topicPolicyConflictPolicy(stack);

    expect(() => Template.fromStack(stack)).toThrow(/another topic policy/);
  });

  it("throws when an inline policy targets a topic that has a TopicPolicy", () => {
    const app = new App();
    const stack = new Stack(app, "Stack");
    const topic = new Topic(stack, "Alerts", { enforceSSL: true });
    new CfnTopicInlinePolicy(stack, "Inline", {
      topicArn: topic.topicArn,
      policyDocument: { Statement: [] },
    });
    topicPolicyConflictPolicy(app);

    expect(() => Template.fromStack(stack)).toThrow(/Stack\/Inline: another topic policy/);
  });

  it("catches policies on the same literal ARN in different stacks", () => {
    const app = new App();
    const a = new Stack(app, "A");
    const b = new Stack(app, "B");
    for (const stack of [a, b]) {
      standalonePolicy(stack, "Policy", Topic.fromTopicArn(stack, "Imported", IMPORTED_ARN));
    }
    topicPolicyConflictPolicy(app);

    expect(() => app.synth()).toThrow(new RegExp(IMPORTED_ARN));
  });

  it("does not confuse same-named topics in different stacks", () => {
    const app = new App();
    const stacks = [new Stack(app, "A"), new Stack(app, "B")];
    for (const stack of stacks) new Topic(stack, "Alerts", { enforceSSL: true });
    topicPolicyConflictPolicy(app);

    expect(() => app.synth()).not.toThrow();
  });

  it("allows policies that share one PolicyDocument", () => {
    const app = new App();
    const stack = new Stack(app, "Stack");
    const topic = new Topic(stack, "Alerts");
    const own = standalonePolicy(stack, "Own", topic);
    new TopicPolicy(stack, "Mirror", { topics: [topic], policyDocument: own.document });
    topicPolicyConflictPolicy(app);

    expect(() => Template.fromStack(stack)).not.toThrow();
  });

  it("warns instead of throwing in warn mode", () => {
    const app = new App();
    const stack = new Stack(app, "Stack");
    const topic = new Topic(stack, "Alerts", { enforceSSL: true });
    standalonePolicy(stack, "Extra", topic);
    topicPolicyConflictPolicy(app, { onViolation: "warn" });

    Annotations.fromStack(stack).hasWarning(
      "/Stack/Extra/Resource",
      Match.stringLikeRegexp(
        `another topic policy.*\\[ack: ${TOPIC_POLICY_CONFLICT_WARNING_ID}\\]`,
      ),
    );
  });

  it("ignores policies that target different topics", () => {
    const app = new App();
    const stack = new Stack(app, "Stack");
    const a = new Topic(stack, "A");
    const b = new Topic(stack, "B");
    standalonePolicy(stack, "PolicyA", a);
    standalonePolicy(stack, "PolicyB", b);
    topicPolicyConflictPolicy(app);

    expect(() => Template.fromStack(stack)).not.toThrow();
  });
});
