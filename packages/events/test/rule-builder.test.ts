import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { EventBus, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { ref } from "@composurecdk/core";
import { createRuleBuilder } from "../src/rule-builder.js";

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

describe("RuleBuilder", () => {
  describe("build", () => {
    it("creates a rule with a schedule", () => {
      const stack = newStack();
      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        ScheduleExpression: "rate(15 minutes)",
      });
    });

    it("creates a rule with an event pattern", () => {
      const stack = newStack();
      createRuleBuilder()
        .eventPattern({ source: ["aws.s3"], detailType: ["Object Created"] })
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        EventPattern: Match.objectLike({
          source: ["aws.s3"],
          "detail-type": ["Object Created"],
        }),
      });
    });

    it("supports both schedule and event pattern on the same rule", () => {
      const stack = newStack();
      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(5)))
        .eventPattern({ source: ["my.app"] })
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        ScheduleExpression: "rate(5 minutes)",
        EventPattern: Match.objectLike({ source: ["my.app"] }),
      });
    });

    it("throws if neither schedule nor event pattern is set", () => {
      const stack = newStack();
      const builder = createRuleBuilder().description("inert");

      expect(() => builder.build(stack, "TestRule")).toThrow(
        /at least one of \.schedule\(\.\.\.\) or \.eventPattern\(\.\.\.\) must be set/,
      );
    });

    it("returns the rule on the result", () => {
      const stack = newStack();
      const result = createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(1)))
        .build(stack, "TestRule");

      expect(result.rule).toBeDefined();
      expect(result.targets).toEqual({});
    });
  });

  describe("addTarget", () => {
    it("attaches a single target to the rule", () => {
      const stack = newStack();
      const fn = makeFn(stack);

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("handler", new LambdaFunction(fn))
        .build(stack, "TestRule");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Events::Rule", {
        Targets: Match.arrayWith([Match.objectLike({ Id: "Target0" })]),
      });
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Action: "lambda:InvokeFunction",
        Principal: "events.amazonaws.com",
      });
    });

    it("attaches multiple targets in registration order", () => {
      const stack = newStack();
      const a = makeFn(stack, "A");
      const b = makeFn(stack, "B");

      const result = createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("primary", new LambdaFunction(a))
        .addTarget("audit", new LambdaFunction(b))
        .build(stack, "TestRule");

      expect(Object.keys(result.targets)).toEqual(["primary", "audit"]);
      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        Targets: Match.arrayWith([
          Match.objectLike({ Id: "Target0" }),
          Match.objectLike({ Id: "Target1" }),
        ]),
      });
    });

    it("throws when the same key is used twice", () => {
      const stack = newStack();
      const fn = makeFn(stack);
      const builder = createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("handler", new LambdaFunction(fn));

      expect(() => builder.addTarget("handler", new LambdaFunction(fn))).toThrow(
        /duplicate key "handler"/,
      );
    });

    it("resolves a Resolvable<IRuleTarget> from the compose context", () => {
      const stack = newStack();
      const fn = makeFn(stack);

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget(
          "handler",
          ref("handler", (r: { function: LambdaFn }) => new LambdaFunction(r.function)),
        )
        .build(stack, "TestRule", { handler: { function: fn } });

      Template.fromStack(stack).resourceCountIs("AWS::Events::Rule", 1);
    });
  });

  describe("eventBus", () => {
    it("resolves a Resolvable<IEventBus> from the compose context", () => {
      const stack = newStack();
      const fn = makeFn(stack);
      const bus = new EventBus(stack, "Bus", { eventBusName: "my-bus" });

      createRuleBuilder()
        .eventBus(ref("bus", (r: { eventBus: typeof bus }) => r.eventBus))
        .eventPattern({ source: ["my.app"] })
        .addTarget("handler", new LambdaFunction(fn))
        .build(stack, "TestRule", { bus: { eventBus: bus } });

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        EventBusName: { Ref: stack.getLogicalId(bus.node.defaultChild as never) },
      });
    });
  });

  describe("copy", () => {
    it("clones registered targets so mutations on one builder do not affect the other", () => {
      const stack = newStack();
      const a = makeFn(stack, "A");
      const b = makeFn(stack, "B");

      const base = createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("a", new LambdaFunction(a));

      const variant = base.copy().addTarget("b", new LambdaFunction(b));

      expect(Object.keys(base.build(stack, "Base").targets)).toEqual(["a"]);
      expect(Object.keys(variant.build(stack, "Variant").targets).sort()).toEqual(["a", "b"]);
    });
  });
});
