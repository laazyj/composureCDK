import { describe, it, expect } from "vitest";
import { Construct } from "constructs";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { newStack } from "@composurecdk/cdk-testing";
import { createBudgetsTopicPolicies } from "../src/topic-policy.js";

const BUDGETS_STATEMENT = Match.objectLike({
  Sid: "AllowBudgetsPublish",
  Effect: "Allow",
  Principal: { Service: "budgets.amazonaws.com" },
  Action: "SNS:Publish",
});

const SSL_STATEMENT = Match.objectLike({ Sid: "AllowPublishThroughSSLOnly" });

describe("createBudgetsTopicPolicies", () => {
  it("returns an empty record when no topics are provided", () => {
    const stack = newStack();
    const policies = createBudgetsTopicPolicies(stack, "Budget", []);

    expect(policies).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::SNS::TopicPolicy", 0);
  });

  it("adds the statement to the topic's own policy, next to enforceSSL's", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Alerts", { enforceSSL: true });

    createBudgetsTopicPolicies(stack, "Budget", [topic]);

    // The topic's own policy and the retained transitional policy both render
    // the one shared document, so either order of application gives the same
    // result.
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::TopicPolicy", 2);
    template.allResourcesProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([SSL_STATEMENT, BUDGETS_STATEMENT]),
      }),
    });
  });

  it("keeps the transitional policy's logical id and retains it on removal", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Alerts");

    const policies = createBudgetsTopicPolicies(stack, "Budget", [topic]);

    const policy = policies[topic.node.path];
    expect(policy.node.id).toBe(`BudgetTopicPolicy${topic.node.addr}`);
    Template.fromStack(stack).hasResource("AWS::SNS::TopicPolicy", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("returns one policy per unique topic", () => {
    const stack = newStack();
    const a = new Topic(stack, "A");
    const b = new Topic(stack, "B");

    const policies = createBudgetsTopicPolicies(stack, "Budget", [a, b, a]);

    expect(Object.keys(policies).sort()).toEqual([a.node.path, b.node.path].sort());
  });

  it("keeps policies distinct when topics in different scopes share a node id", () => {
    const stack = newStack();
    const a = new Topic(new Construct(stack, "ScopeA"), "AlertsTopic");
    const b = new Topic(new Construct(stack, "ScopeB"), "AlertsTopic");

    const policies = createBudgetsTopicPolicies(stack, "Budget", [a, b]);

    expect(Object.keys(policies)).toHaveLength(2);
  });

  it("falls back to a standalone policy, with a warning, for an imported topic", () => {
    const stack = newStack();
    const topic = Topic.fromTopicArn(
      stack,
      "Imported",
      "arn:aws:sns:us-east-1:123456789012:alerts",
    );

    const policies = createBudgetsTopicPolicies(stack, "Budget", [topic]);

    expect(Object.keys(policies)).toEqual([topic.node.path]);
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::SNS::TopicPolicy", 1);
    template.hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: Match.objectLike({ Statement: [BUDGETS_STATEMENT] }),
    });
    Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp("imported-topic-policy"));
  });

  it("warns when the topic's own policy cannot be found", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Alerts");
    topic.addToResourcePolicy = () => ({ statementAdded: true });

    const policies = createBudgetsTopicPolicies(stack, "Budget", [topic]);

    expect(policies).toEqual({});
    Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp("topic-policy-not-found"));
  });
});
