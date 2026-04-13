import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { createBudgetsTopicPolicies } from "../src/topic-policy.js";

function newStack(): Stack {
  const app = new App();
  return new Stack(app, "TestStack");
}

describe("createBudgetsTopicPolicies", () => {
  it("returns an empty record when no topics are provided", () => {
    const stack = newStack();
    const policies = createBudgetsTopicPolicies(stack, "Budget", []);

    expect(policies).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::SNS::TopicPolicy", 0);
  });

  it("creates one TopicPolicy per unique topic", () => {
    const stack = newStack();
    const a = new Topic(stack, "A");
    const b = new Topic(stack, "B");

    const policies = createBudgetsTopicPolicies(stack, "Budget", [a, b]);

    expect(Object.keys(policies).sort()).toEqual(["A", "B"]);
    Template.fromStack(stack).resourceCountIs("AWS::SNS::TopicPolicy", 2);
  });

  it("deduplicates repeated topics", () => {
    const stack = newStack();
    const a = new Topic(stack, "A");

    const policies = createBudgetsTopicPolicies(stack, "Budget", [a, a]);

    expect(Object.keys(policies)).toEqual(["A"]);
    Template.fromStack(stack).resourceCountIs("AWS::SNS::TopicPolicy", 1);
  });

  it("grants budgets.amazonaws.com permission to publish to each topic", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Alerts");

    createBudgetsTopicPolicies(stack, "Budget", [topic]);

    Template.fromStack(stack).hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "AllowBudgetsPublish",
            Effect: "Allow",
            Principal: { Service: "budgets.amazonaws.com" },
            Action: "SNS:Publish",
          }),
        ]),
      }),
    });
  });
});
