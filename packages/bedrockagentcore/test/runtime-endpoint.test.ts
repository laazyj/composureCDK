import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import type { IBedrockAgentRuntime } from "aws-cdk-lib/aws-bedrockagentcore";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import type { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { ref } from "@composurecdk/core";
import type { AgentCoreMetricSource } from "../src/alarms.js";
import { createRuntimeEndpointBuilder } from "../src/runtime-endpoint.js";
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
