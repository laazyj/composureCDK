import { describe, it, expect, vi } from "vitest";
import { Annotations as CdkAnnotations, ArnFormat, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { EventBus, type IRuleTarget, Rule, Schedule } from "aws-cdk-lib/aws-events";
import { Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { DefinitionBody, Pass, StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import {
  CloudWatchLogGroup as CloudWatchLogGroupTarget,
  EventBus as EventBusTarget,
  LambdaFunction as LambdaFunctionTarget,
  SfnStateMachine as SfnStateMachineTarget,
  SnsTopic as SnsTopicTarget,
  SqsQueue as SqsQueueTarget,
} from "aws-cdk-lib/aws-events-targets";
import { newStack } from "@composurecdk/cdk-testing";
import { isRef, ref } from "@composurecdk/core";
import { createRuleBuilder, type IRuleBuilder } from "../../src/rule-builder.js";
import { lambdaTarget } from "../../src/targets/lambda-target.js";
import { sqsTarget } from "../../src/targets/sqs-target.js";
import { snsTarget } from "../../src/targets/sns-target.js";
import { sfnStateMachineTarget } from "../../src/targets/sfn-state-machine-target.js";
import { eventBusTarget } from "../../src/targets/event-bus-target.js";
import { cloudWatchLogGroupTarget } from "../../src/targets/cloud-watch-log-group-target.js";

function makeFn(stack: Stack, id = "Handler"): LambdaFn {
  return new LambdaFn(stack, id, {
    runtime: Runtime.PROVIDED_AL2,
    handler: "bootstrap",
    code: Code.fromAsset("test/fixtures/lambda"),
  });
}

describe("target helpers", () => {
  describe("lambdaTarget", () => {
    it("accepts every function CDK's own LambdaFunction target accepts (type-level guard)", () => {
      // The helper reads its accepted type from CDK's own target constructor,
      // so this holds at whatever `aws-cdk-lib` is installed. It fails if the
      // parameter is re-pinned to a named interface after CDK widens the
      // constructor — the narrowing CDK's `*Ref` migration lands on a pinned
      // target, and what issue #401 was about (ADR-0018). Re-pinning before
      // CDK moves still compiles, which is why the rule is the ADR's, not
      // this guard's, to enforce.
      const _fn: Parameters<typeof lambdaTarget>[0] = undefined as unknown as ConstructorParameters<
        typeof LambdaFunctionTarget
      >[0];
    });

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
    it("accepts every queue CDK's own SqsQueue target accepts (type-level guard)", () => {
      // Same guard as `lambdaTarget`'s; see the comment there (ADR-0018).
      const _queue: Parameters<typeof sqsTarget>[0] = undefined as unknown as ConstructorParameters<
        typeof SqsQueueTarget
      >[0];
    });

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

    it("returns a Ref<IRuleTarget> for a Ref<IQueue> and synths the rule", () => {
      const stack = newStack();
      const queue = new Queue(stack, "Q");

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("queue", sqsTarget(ref("q", (r: { q: Queue }) => r.q)))
        .build(stack, "TestRule", { q: { q: queue } });

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
  });

  describe("sqsTarget with a KMS-encrypted queue", () => {
    const IMPORTED_KEY_ARN =
      "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";

    function keyedRule({
      configure = (r) => r,
      queueProps = (stack) => ({ encryptionMasterKey: new Key(stack, "Key") }),
    }: {
      configure?: (rule: IRuleBuilder, stack: Stack) => IRuleBuilder;
      queueProps?: (stack: Stack) => QueueProps;
    } = {}): Stack {
      const stack = newStack();
      const queue = new Queue(stack, "Q", queueProps(stack));
      configure(
        createRuleBuilder()
          .eventPattern({ source: ["my.app"] })
          .addTarget("queue", sqsTarget(queue)),
        stack,
      ).build(stack, "TestRule");
      return stack;
    }

    function ruleArn(stack: Stack, resourceName: string): unknown {
      return stack.resolve(
        stack.formatArn({
          service: "events",
          resource: "rule",
          resourceName,
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
        }),
      );
    }

    function eventsStatements(stack: Stack, type: string, key: string): unknown[] {
      const [resource] = Object.values(Template.fromStack(stack).findResources(type)) as {
        Properties: Record<string, { Statement: { Principal?: { Service?: string } }[] }>;
      }[];
      return resource.Properties[key].Statement.filter(
        (s) => s.Principal?.Service === "events.amazonaws.com",
      );
    }

    it("names an unnamed rule, so its ARN can be written without referencing it", () => {
      const stack = keyedRule();

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        Name: Match.stringLikeRegexp("^TestStackTestRule"),
      });
    });

    it("keeps a name set with .ruleName(...) and scopes the queue policy to it", () => {
      const stack = keyedRule({ configure: (r) => r.ruleName("my-rule") });

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", { Name: "my-rule" });

      expect(eventsStatements(stack, "AWS::SQS::QueuePolicy", "PolicyDocument")).toEqual([
        expect.objectContaining({
          Action: "sqs:SendMessage",
          Condition: { ArnEquals: { "aws:SourceArn": ruleArn(stack, "my-rule") } },
        }),
      ]);
    });

    it("scopes the key policy to GenerateDataKey and Decrypt from the rule", () => {
      const stack = keyedRule({ configure: (r) => r.ruleName("my-rule") });

      expect(eventsStatements(stack, "AWS::KMS::Key", "KeyPolicy")).toEqual([
        expect.objectContaining({
          Action: ["kms:GenerateDataKey", "kms:Decrypt"],
          Condition: {
            ArnEquals: { "aws:SourceArn": ruleArn(stack, "my-rule") },
            StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
          },
        }),
      ]);
    });

    it("puts the bus name in the ARN of a rule on a custom event bus", () => {
      const stack = keyedRule({
        configure: (r, s) => r.ruleName("my-rule").eventBus(new EventBus(s, "Bus")),
      });
      const bus = stack.node.findChild("Bus") as EventBus;

      expect(eventsStatements(stack, "AWS::KMS::Key", "KeyPolicy")).toEqual([
        expect.objectContaining({
          Condition: {
            ArnEquals: { "aws:SourceArn": ruleArn(stack, `${bus.eventBusName}/my-rule`) },
            StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
          },
        }),
      ]);
    });

    it("warns with the statement to add when the key is imported", () => {
      const stack = keyedRule({
        queueProps: (s) => ({
          encryptionMasterKey: Key.fromKeyArn(s, "Key", IMPORTED_KEY_ARN),
        }),
      });

      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp(
          "KMS key is imported or AWS-managed.*kms:GenerateDataKey.*\\[ack: @composurecdk/events:sqs-target-key-not-granted\\]",
        ),
      );
    });

    it("degrades to addWarning below aws-cdk-lib 2.93.0, this package's floor being 2.85.0", () => {
      // The fallback is unreachable on a current aws-cdk-lib without removing
      // addWarningV2; same shim test as @composurecdk/cloudformation's.
      const proto = CdkAnnotations.prototype as unknown as Record<string, unknown>;
      const original = proto.addWarningV2;
      const addWarning = vi.spyOn(CdkAnnotations.prototype, "addWarning");
      delete proto.addWarningV2;
      try {
        keyedRule({
          queueProps: (s) => ({ encryptionMasterKey: Key.fromKeyArn(s, "Key", IMPORTED_KEY_ARN) }),
        });
        expect(addWarning).toHaveBeenCalledWith(
          expect.stringContaining("KMS key is imported or AWS-managed"),
        );
      } finally {
        proto.addWarningV2 = original;
        addWarning.mockRestore();
      }
    });

    it("throws when bound to a rule with no AWS::Events::Rule resource", () => {
      const stack = newStack();
      const queue = new Queue(stack, "Q", { encryptionMasterKey: new Key(stack, "Key") });
      const imported = Rule.fromEventRuleArn(
        stack,
        "Imported",
        "arn:aws:events:us-east-1:123456789012:rule/other",
      );

      expect(() => (sqsTarget(queue) as IRuleTarget).bind(imported)).toThrow(
        /has no AWS::Events::Rule resource/,
      );
    });

    it("leaves a rule targeting an unencrypted queue unnamed", () => {
      const stack = keyedRule({ queueProps: () => ({}) });

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        Name: Match.absent(),
      });
    });

    it("threads target props (DLQ, retry, FIFO group) through", () => {
      const stack = newStack();
      const dlq = new Queue(stack, "Dlq");
      const queue = new Queue(stack, "Q", {
        fifo: true,
        encryptionMasterKey: new Key(stack, "Key"),
      });

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget(
          "queue",
          sqsTarget(queue, { deadLetterQueue: dlq, retryAttempts: 2, messageGroupId: "g" }),
        )
        .build(stack, "TestRule");

      Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
        Targets: [
          Match.objectLike({
            DeadLetterConfig: { Arn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Dlq"), "Arn"] } },
            RetryPolicy: { MaximumRetryAttempts: 2 },
            SqsParameters: { MessageGroupId: "g" },
          }),
        ],
      });
      Template.fromStack(stack).resourceCountIs("AWS::SQS::QueuePolicy", 2);
    });
  });

  describe("snsTarget", () => {
    it("accepts every topic CDK's own SnsTopic target accepts (type-level guard)", () => {
      // Same guard as `lambdaTarget`'s; see the comment there (ADR-0018).
      const _topic: Parameters<typeof snsTarget>[0] = undefined as unknown as ConstructorParameters<
        typeof SnsTopicTarget
      >[0];
    });

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

    it("returns a Ref<IRuleTarget> for a Ref<ITopic> and synths the rule", () => {
      const stack = newStack();
      const topic = new Topic(stack, "T");

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("topic", snsTarget(ref("t", (r: { t: Topic }) => r.t)))
        .build(stack, "TestRule", { t: { t: topic } });

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
    it("accepts every state machine CDK's own SfnStateMachine target accepts (type-level guard)", () => {
      // Same guard as `lambdaTarget`'s; see the comment there (ADR-0018).
      const _stateMachine: Parameters<typeof sfnStateMachineTarget>[0] =
        undefined as unknown as ConstructorParameters<typeof SfnStateMachineTarget>[0];
    });

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

    it("returns a Ref<IRuleTarget> for a Ref<IStateMachine> and synths the rule", () => {
      const stack = newStack();
      const sm = new StateMachine(stack, "SM", {
        definitionBody: DefinitionBody.fromChainable(new Pass(stack, "P")),
      });

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("sm", sfnStateMachineTarget(ref("sm", (r: { sm: StateMachine }) => r.sm)))
        .build(stack, "TestRule", { sm: { sm } });

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Action: "states:StartExecution" })]),
        }),
      });
    });
  });

  describe("eventBusTarget", () => {
    it("accepts every bus CDK's own EventBus target accepts (type-level guard)", () => {
      // Same guard as `lambdaTarget`'s; see the comment there (ADR-0018).
      const _bus: Parameters<typeof eventBusTarget>[0] =
        undefined as unknown as ConstructorParameters<typeof EventBusTarget>[0];
    });

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

    it("returns a Ref<IRuleTarget> for a Ref<IEventBus> and synths the rule", () => {
      const stack = newStack();
      const downstream = new EventBus(stack, "Downstream");

      createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("forward", eventBusTarget(ref("bus", (r: { bus: EventBus }) => r.bus)))
        .build(stack, "TestRule", { bus: { bus: downstream } });

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Action: "events:PutEvents" })]),
        }),
      });
    });
  });

  describe("cloudWatchLogGroupTarget", () => {
    it("accepts every log group CDK's own CloudWatchLogGroup target accepts (type-level guard)", () => {
      // The helper reads its accepted type from CDK's own target constructor,
      // which already takes the broader `logs.ILogGroupRef` — pinning
      // `ILogGroup` rejected a log group CDK itself takes (ADR-0018).
      const _logGroup: Parameters<typeof cloudWatchLogGroupTarget>[0] =
        undefined as unknown as ConstructorParameters<typeof CloudWatchLogGroupTarget>[0];
    });

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

    it("returns a Ref<IRuleTarget> for a Ref<ILogGroup> and synths the rule", () => {
      const stack = newStack();
      const lg = new LogGroup(stack, "LG");
      const lgLogicalId = stack.getLogicalId(lg.node.defaultChild as never);

      createRuleBuilder()
        .eventPattern({ source: ["my.app"] })
        .addTarget("audit", cloudWatchLogGroupTarget(ref("lg", (r: { lg: LogGroup }) => r.lg)))
        .build(stack, "TestRule", { lg: { lg } });

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
