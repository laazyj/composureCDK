import { describe, it, expect } from "vitest";
import { type CfnResource, RemovalPolicy, type Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { MethodLoggingLevel, MockIntegration } from "aws-cdk-lib/aws-apigateway";
import { Key } from "aws-cdk-lib/aws-kms";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createRestApiBuilder } from "../src/rest-api-builder.js";

const buildAndSynth = buildFixture(createRestApiBuilder, "TestApi", {
  seed: (b) => b.addMethod("GET", new MockIntegration()),
});

function logicalId(stack: Stack, construct: IConstruct): string {
  return stack.getLogicalId(construct.node.defaultChild as CfnResource);
}

function executionLogGroupName(apiLogicalId: string, stageName = "prod") {
  return {
    "Fn::Join": ["", ["API-Gateway-Execution-Logs_", { Ref: apiLogicalId }, `/${stageName}`]],
  };
}

describe("execution logging", () => {
  it("creates the execution log group with the logs defaults, ahead of the stage", () => {
    const { result, template, stack } = buildAndSynth();
    const logGroup = result.executionLogGroup;
    if (!logGroup) throw new Error("expected an execution log group");

    template.hasResource("AWS::Logs::LogGroup", {
      Properties: {
        LogGroupName: executionLogGroupName(logicalId(stack, result.api)),
        RetentionInDays: 731,
      },
      DeletionPolicy: "Retain",
    });
    template.hasResource("AWS::ApiGateway::Stage", {
      DependsOn: Match.arrayWith([logicalId(stack, logGroup)]),
    });
  });

  it("names the group from the configured stage name", () => {
    const { result, template, stack } = buildAndSynth((b) => b.deployOptions({ stageName: "v1" }));

    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: executionLogGroupName(logicalId(stack, result.api), "v1"),
    });
  });

  it("applies the configure callback", () => {
    const { template } = buildAndSynth((b) =>
      b.executionLogging({
        configure: (lg) =>
          lg.retention(RetentionDays.ONE_MONTH).removalPolicy(RemovalPolicy.DESTROY),
      }),
    );

    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 30 },
      DeletionPolicy: "Delete",
    });
  });

  it("configure callback can reach a sibling component through a ref", () => {
    const stack = newStack();
    const key = new Key(stack, "LogsKey");

    createRestApiBuilder()
      .addMethod("GET", new MockIntegration())
      .executionLogging({
        configure: (lg) => lg.encryptionKey(ref<{ key: Key }>("logsKey").get("key")),
      })
      .build(stack, "TestApi", { logsKey: { key } });

    Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
      KmsKeyId: { "Fn::GetAtt": [logicalId(stack, key), "Arn"] },
    });
  });

  it("is not created when executionLogging is false", () => {
    const { result } = buildAndSynth((b) => b.executionLogging(false));

    expect(result.executionLogGroup).toBeUndefined();
  });

  it("is not created when the stage's logging level is OFF", () => {
    const { result } = buildAndSynth((b) =>
      b.deployOptions({ loggingLevel: MethodLoggingLevel.OFF }),
    );

    expect(result.executionLogGroup).toBeUndefined();
  });

  it("is created when only a method enables logging", () => {
    const { result } = buildAndSynth((b) =>
      b.deployOptions({
        loggingLevel: MethodLoggingLevel.OFF,
        methodOptions: { "/*/GET": { loggingLevel: MethodLoggingLevel.ERROR } },
      }),
    );

    expect(result.executionLogGroup).toBeDefined();
  });
});
