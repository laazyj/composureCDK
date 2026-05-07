import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { EventBus, Schedule } from "aws-cdk-lib/aws-events";
import { Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { DefinitionBody, Pass, StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { isRef, ref } from "@composurecdk/core";
import { createRuleBuilder } from "../../src/rule-builder.js";
import { lambdaTarget } from "../../src/targets/lambda-target.js";
import { sqsTarget } from "../../src/targets/sqs-target.js";
import { snsTarget } from "../../src/targets/sns-target.js";
import { sfnStateMachineTarget } from "../../src/targets/sfn-state-machine-target.js";
import { eventBusTarget } from "../../src/targets/event-bus-target.js";
import { cloudWatchLogGroupTarget } from "../../src/targets/cloud-watch-log-group-target.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack");
}

function makeFn(stack: Stack, id = "Handler"): LambdaFn {
  return new LambdaFn(stack, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = async () => {};"),
  });
}

describe("target helpers", () => {
  describe("lambdaTarget", () => {
    it("returns a concrete IRuleTarget for a concrete function", () => {
      const stack = newStack();
      const fn = makeFn(stack);

      const target = lambdaTarget(fn);

      expect(isRef(target)).toBe(false);
    });

    it("returns a Ref<IRuleTarget> for a Ref<IFunction> and synths the rule", () => {
      const stack = newStack();
      const fn = makeFn(stack);

      const target = lambdaTarget(ref("h", (r: { fn: LambdaFn }) => r.fn));
      expect(isRef(target)).toBe(true);

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("handler", target)
        .build(stack, "TestRule", { h: { fn } });

      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Permission", {
        Action: "lambda:InvokeFunction",
        Principal: "events.amazonaws.com",
      });
    });

    it("threads target props (DLQ, retry, input) through to the underlying target", () => {
      const stack = newStack();
      const fn = makeFn(stack);
      const dlq = new Queue(stack, "Dlq");

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget(
          "handler",
          lambdaTarget(fn, {
            deadLetterQueue: dlq,
            retryAttempts: 2,
            maxEventAge: Duration.hours(1),
          }),
        )
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        Targets: Match.arrayWith([
          Match.objectLike({
            DeadLetterConfig: Match.objectLike({}),
            RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
          }),
        ]),
      });
    });
  });

  describe("sqsTarget", () => {
    it("attaches an SQS queue and grants SendMessage", () => {
      const stack = newStack();
      const queue = new Queue(stack, "Q");

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("queue", sqsTarget(queue))
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["sqs:SendMessage"]),
              Principal: { Service: "events.amazonaws.com" },
            }),
          ]),
        }),
      });
    });

    it("returns a Ref for a Ref input", () => {
      expect(isRef(sqsTarget(ref("q", (r: { q: Queue }) => r.q)))).toBe(true);
    });
  });

  describe("snsTarget", () => {
    it("attaches an SNS topic", () => {
      const stack = newStack();
      const topic = new Topic(stack, "T");

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("topic", snsTarget(topic))
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::SNS::TopicPolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sns:Publish",
              Principal: { Service: "events.amazonaws.com" },
            }),
          ]),
        }),
      });
    });
  });

  describe("sfnStateMachineTarget", () => {
    it("attaches a state machine with an invoke role", () => {
      const stack = newStack();
      const sm = new StateMachine(stack, "SM", {
        definitionBody: DefinitionBody.fromChainable(new Pass(stack, "P")),
      });

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("sm", sfnStateMachineTarget(sm))
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Action: "states:StartExecution" })]),
        }),
      });
    });
  });

  describe("eventBusTarget", () => {
    it("attaches another bus and grants events:PutEvents", () => {
      const stack = newStack();
      const downstream = new EventBus(stack, "Downstream");

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("forward", eventBusTarget(downstream))
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Action: "events:PutEvents" })]),
        }),
      });
    });
  });

  describe("cloudWatchLogGroupTarget", () => {
    it("attaches the log group ARN as the target ARN on the rule", () => {
      const stack = newStack();
      const lg = new LogGroup(stack, "LG");
      const lgLogicalId = stack.getLogicalId(lg.node.defaultChild as never);

      createRuleBuilder()
        .eventPattern({ source: ["my.app"] })
        .addTarget("audit", cloudWatchLogGroupTarget(lg))
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.objectLike({
              "Fn::Join": Match.arrayWith([
                Match.arrayWith([Match.objectLike({ Ref: lgLogicalId })]),
              ]),
            }),
          }),
        ]),
      });
    });
  });
});
