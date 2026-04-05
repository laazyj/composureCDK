import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  ApiDefinition,
  LogGroupLogDestination,
  MethodLoggingLevel,
} from "aws-cdk-lib/aws-apigateway";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { createSpecRestApiBuilder } from "../src/spec-rest-api-builder.js";

/** Minimal OpenAPI 3.0 spec with a single mock-integrated GET /pets endpoint. */
function minimalOpenApiSpec() {
  return {
    openapi: "3.0.2",
    info: { title: "TestApi", version: "1.0" },
    paths: {
      "/pets": {
        get: {
          responses: { "200": { description: "OK" } },
          "x-amazon-apigateway-integration": {
            type: "MOCK",
            requestTemplates: { "application/json": '{ "statusCode": 200 }' },
            responses: { default: { statusCode: "200" } },
          },
        },
      },
    },
  };
}

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createSpecRestApiBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createSpecRestApiBuilder();
  configureFn(builder);
  builder.build(stack, "TestApi");
  return Template.fromStack(stack);
}

/** Adds a minimal apiDefinition so the API passes CDK validation. */
function withStubDefinition(builder: ReturnType<typeof createSpecRestApiBuilder>) {
  return builder.apiDefinition(ApiDefinition.fromInline(minimalOpenApiSpec()));
}

describe("SpecRestApiBuilder", () => {
  describe("build", () => {
    it("returns a SpecRestApiBuilderResult with an api property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createSpecRestApiBuilder();

      withStubDefinition(builder).restApiName("TestApi");

      const result = builder.build(stack, "TestApi");

      expect(result).toBeDefined();
      expect(result.api).toBeDefined();
    });

    it("returns the auto-created access log group in the result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createSpecRestApiBuilder();

      withStubDefinition(builder);

      const result = builder.build(stack, "TestApi");

      expect(result.accessLogGroup).toBeDefined();
    });

    it("returns undefined accessLogGroup when access logging is disabled", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createSpecRestApiBuilder();

      withStubDefinition(builder.accessLogging(false));

      const result = builder.build(stack, "TestApi");

      expect(result.accessLogGroup).toBeUndefined();
    });

    it("returns undefined accessLogGroup when user provides their own destination", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogGroup = new LogGroup(stack, "UserLogGroup");
      const builder = createSpecRestApiBuilder();

      withStubDefinition(
        builder.deployOptions({
          accessLogDestination: new LogGroupLogDestination(userLogGroup),
        }),
      );

      const result = builder.build(stack, "TestApi");

      expect(result.accessLogGroup).toBeUndefined();
    });
  });

  describe("synthesised output", () => {
    it("creates a REST API with the specified name", () => {
      const template = synthTemplate((b) => withStubDefinition(b.restApiName("My Service")));

      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Name: "My Service",
      });
    });

    it("creates a REST API from an inline OpenAPI definition", () => {
      const template = synthTemplate((b) => withStubDefinition(b.restApiName("My Service")));

      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Body: Match.objectLike({
          openapi: "3.0.2",
          info: { title: "TestApi", version: "1.0" },
        }),
      });
    });

    it("creates a deployment and stage by default", () => {
      const template = synthTemplate((b) => withStubDefinition(b.restApiName("My Service")));

      template.resourceCountIs("AWS::ApiGateway::Deployment", 1);
      template.resourceCountIs("AWS::ApiGateway::Stage", 1);
    });

    it("creates exactly one REST API", () => {
      const template = synthTemplate((b) => withStubDefinition(b.restApiName("My Service")));

      template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    });
  });

  describe("secure defaults", () => {
    it("enables X-Ray tracing on the stage by default", () => {
      const template = synthTemplate((b) => withStubDefinition(b));

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        TracingEnabled: true,
      });
    });

    it("enables CloudWatch execution logging by default", () => {
      const template = synthTemplate((b) => withStubDefinition(b));

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: Match.arrayWith([Match.objectLike({ LoggingLevel: "INFO" })]),
      });
    });

    it("creates an access log group by default", () => {
      const template = synthTemplate((b) => withStubDefinition(b));

      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 731,
      });
    });

    it("configures access log destination on the stage by default", () => {
      const template = synthTemplate((b) => withStubDefinition(b));

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        AccessLogSetting: {
          DestinationArn: Match.anyValue(),
        },
      });
    });

    it("allows the user to override tracing", () => {
      const template = synthTemplate((b) =>
        withStubDefinition(b.deployOptions({ tracingEnabled: false })),
      );

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        TracingEnabled: false,
      });
    });

    it("allows the user to override logging level", () => {
      const template = synthTemplate((b) =>
        withStubDefinition(b.deployOptions({ loggingLevel: MethodLoggingLevel.ERROR })),
      );

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: Match.arrayWith([Match.objectLike({ LoggingLevel: "ERROR" })]),
      });
    });

    it("skips auto log group when user provides their own access log destination", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogGroup = new LogGroup(stack, "UserLogGroup");
      const builder = createSpecRestApiBuilder();
      withStubDefinition(
        builder.deployOptions({
          accessLogDestination: new LogGroupLogDestination(userLogGroup),
        }),
      );
      builder.build(stack, "TestApi");
      const template = Template.fromStack(stack);

      // Only the user-provided log group exists, no auto-created one
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("creates no log group when access logging is disabled", () => {
      const template = synthTemplate((b) => withStubDefinition(b.accessLogging(false)));

      template.resourceCountIs("AWS::Logs::LogGroup", 0);
    });

    it("preserves user deployOptions while applying defaults for missing fields", () => {
      const template = synthTemplate((b) =>
        withStubDefinition(b.deployOptions({ stageName: "live" })),
      );

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        StageName: "live",
        TracingEnabled: true,
        AccessLogSetting: {
          DestinationArn: Match.anyValue(),
        },
      });
    });
  });
});
