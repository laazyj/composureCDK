import { describe, it, expect } from "vitest";
import { type CfnResource, RemovalPolicy, type Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  AccessLogFormat,
  ApiDefinition,
  LogGroupLogDestination,
  MockIntegration,
  type StageOptions,
} from "aws-cdk-lib/aws-apigateway";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createRestApiBuilder } from "../src/rest-api-builder.js";
import { createSpecRestApiBuilder } from "../src/spec-rest-api-builder.js";
import type { AccessLoggingConfig } from "../src/deploy-options.js";

/** The surface both REST API builders share that these tests drive. */
interface AccessLoggingBuilder {
  accessLogging(config: AccessLoggingConfig): AccessLoggingBuilder;
  deployOptions(options: StageOptions): AccessLoggingBuilder;
  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): { accessLogGroup?: LogGroup };
}

function logicalId(stack: Stack, construct: IConstruct): string {
  return stack.getLogicalId(construct.node.defaultChild as CfnResource);
}

const SPEC = {
  openapi: "3.0.2",
  info: { title: "TestApi", version: "1.0" },
  paths: {
    "/": {
      get: {
        responses: { "200": { description: "OK" } },
        "x-amazon-apigateway-integration": { type: "MOCK" },
      },
    },
  },
};

const seeded: Record<string, () => AccessLoggingBuilder> = {
  RestApiBuilder: () => createRestApiBuilder().addMethod("GET", new MockIntegration()),
  SpecRestApiBuilder: () =>
    createSpecRestApiBuilder().apiDefinition(ApiDefinition.fromInline(SPEC)),
};

describe.each(Object.entries(seeded))("%s access logging", (_, factory) => {
  const buildAndSynth = buildFixture(factory, "TestApi");

  it("creates the access log group with the logs defaults for {}", () => {
    const { result } = buildAndSynth((b) => b.accessLogging({}));

    expect(result.accessLogGroup).toBeDefined();
  });

  it("applies the configure callback without changing the stage's access log setting", () => {
    const { template } = buildAndSynth((b) =>
      b.accessLogging({
        configure: (lg) =>
          lg.retention(RetentionDays.ONE_MONTH).removalPolicy(RemovalPolicy.DESTROY),
      }),
    );

    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 30 },
      DeletionPolicy: "Delete",
    });
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      AccessLogSetting: {
        DestinationArn: Match.anyValue(),
        Format: AccessLogFormat.jsonWithStandardFields().toString(),
      },
    });
  });

  it("configure callback can reach a sibling component through a ref", () => {
    const stack = newStack();
    const key = new Key(stack, "LogsKey");

    factory()
      .accessLogging({
        configure: (lg) => lg.encryptionKey(ref<{ key: Key }>("logsKey").get("key")),
      })
      .build(stack, "TestApi", { logsKey: { key } });

    Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
      KmsKeyId: { "Fn::GetAtt": [logicalId(stack, key), "Arn"] },
    });
  });

  it("rejects configure combined with a user-supplied accessLogDestination", () => {
    expect(() =>
      buildAndSynth((b, stack) =>
        b.accessLogging({ configure: (lg) => lg }).deployOptions({
          accessLogDestination: new LogGroupLogDestination(
            LogGroup.fromLogGroupName(stack, "UserLogs", "user-logs"),
          ),
        }),
      ),
    ).toThrow(/accessLogging: 'configure' cannot be combined with/);
  });
});
