import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import type { IBedrockAgentRuntime } from "aws-cdk-lib/aws-bedrockagentcore";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { assertAssignable, buildFixture, newStack } from "@composurecdk/cdk-testing";
import type { AlarmDefinitionBuilder, WithCustomAlarms } from "@composurecdk/cloudwatch";
import { compose, ref } from "@composurecdk/core";
import type { AgentCoreMetricSource } from "../src/alarms.js";
import {
  createRuntimeEndpointBuilder,
  type RuntimeEndpointBuilderResult,
} from "../src/runtime-endpoint.js";
import { importedRuntime } from "./fixtures.js";

const buildAndSynth = buildFixture(createRuntimeEndpointBuilder, "Prod");

describe("createRuntimeEndpointBuilder", () => {
  it("requires a runtime and an endpoint name", () => {
    expect(() => buildAndSynth()).toThrow(/requires a runtime and an endpointName/);
  });

  it("adds a versioned endpoint with its log group and alarms", () => {
    const { template, result } = buildAndSynth((b, stack) =>
      b.runtime(importedRuntime(stack)).endpointName("prod").agentRuntimeVersion("3"),
    );

    template.hasResourceProperties("AWS::BedrockAgentCore::RuntimeEndpoint", {
      Name: "prod",
      AgentRuntimeId: "support-abcdefghij",
      AgentRuntimeVersion: "3",
    });
    template.hasResource("Custom::LogRetention", {
      Properties: Match.objectLike({
        LogGroupName: "/aws/bedrock-agentcore/runtimes/support-abcdefghij-prod",
      }),
      DependsOn: [Match.stringLikeRegexp("^Prod")],
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Throttles",
      Dimensions: Match.arrayWith([{ Name: "Name", Value: "support::prod" }]),
    });
    expect(Object.keys(result.alarms)).toEqual(["systemErrors", "throttles", "userErrors"]);
  });

  it("resolves the runtime from the build context", () => {
    const stack = newStack();
    createRuntimeEndpointBuilder()
      .runtime(ref<{ runtime: IBedrockAgentRuntime }>("agent").get("runtime"))
      .endpointName("prod")
      .build(stack, "Prod", { agent: { runtime: importedRuntime(stack) } });

    Template.fromStack(stack).resourceCountIs("AWS::BedrockAgentCore::RuntimeEndpoint", 1);
  });

  it("copies custom alarms independently", () => {
    const invocations = (a: AlarmDefinitionBuilder<AgentCoreMetricSource>) =>
      a
        .metric((m) => m.metric("Invocations"))
        .threshold(1)
        .greaterThan();
    const base = createRuntimeEndpointBuilder().endpointName("prod").addAlarm("a", invocations);
    const copy = base.copy().addAlarm("b", invocations);

    const build = (b: typeof base) => {
      const stack = newStack();
      return b.runtime(importedRuntime(stack)).recommendedAlarms(false).build(stack, "Prod").alarms;
    };
    expect(Object.keys(build(base))).toEqual(["a"]);
    expect(Object.keys(build(copy))).toEqual(["a", "b"]);
  });
});

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const { result, template } = buildAndSynth((b, stack) =>
      b
        .runtime(importedRuntime(stack))
        .endpointName("prod")
        .recommendedAlarms(false)
        .addAlarms({
          invocations: (a) =>
            a
              .metric((m) => m.metric("Invocations"))
              .threshold(1000)
              .greaterThan(),
          sessions: (a) =>
            a
              .metric((m) => m.metric("SessionCount"))
              .threshold(10)
              .greaterThan(),
        }),
    );

    expect(Object.keys(result.alarms)).toEqual(["invocations", "sessions"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth((b, stack) =>
      b.runtime(importedRuntime(stack)).endpointName("prod"),
    );
    const typed: RuntimeEndpointBuilderResult = result;
    const userErrors = typed.alarms.userErrors;

    assertAssignable<Alarm | undefined, typeof userErrors>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof userErrors>();
    expect(userErrors).toBeDefined();
    // @ts-expect-error -- "targetExecutionTime" is a gateway alarm, not an endpoint's
    expect(typed.alarms.targetExecutionTime).toBeUndefined();
  });

  it("resolves a declared custom key through a typed ref, and rejects an undeclared one", () => {
    const stack = newStack();
    const system = compose(
      {
        endpoint: createRuntimeEndpointBuilder()
          .runtime(importedRuntime(stack))
          .endpointName("prod")
          .addAlarm("sessions", (a) =>
            a
              .metric((m) => m.metric("SessionCount"))
              .threshold(10)
              .greaterThan(),
          ),
        consumer: {
          build: (_scope: unknown, _id: string, context: Record<string, object>) => ({
            alarm: ref(
              "endpoint",
              (r: WithCustomAlarms<RuntimeEndpointBuilderResult, "sessions">) => {
                // @ts-expect-error -- "session" was not declared as a custom key
                expect(r.alarms.session).toBeUndefined();
                return r.alarms.sessions;
              },
            ).resolve(context),
          }),
        },
      },
      { endpoint: [], consumer: ["endpoint"] },
    );

    const built = system.build(stack, "System");
    assertAssignable<Alarm, typeof built.consumer.alarm>();
    expect(built.consumer.alarm).toBe(built.endpoint.alarms.sessions);
  });
});
