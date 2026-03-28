import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  LogGroupLogDestination,
  MethodLoggingLevel,
  MockIntegration,
  PassthroughBehavior,
} from "aws-cdk-lib/aws-apigateway";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { createRestApiBuilder } from "../src/rest-api-builder.js";

function mockIntegration(body: Record<string, unknown>) {
  return new MockIntegration({
    integrationResponses: [
      {
        statusCode: "200",
        responseTemplates: { "application/json": JSON.stringify(body) },
      },
    ],
    passthroughBehavior: PassthroughBehavior.NEVER,
    requestTemplates: { "application/json": '{ "statusCode": 200 }' },
  });
}

const stubIntegration = mockIntegration({ ok: true });
const methodResponse200 = { methodResponses: [{ statusCode: "200" }] };

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createRestApiBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createRestApiBuilder();
  configureFn(builder);
  builder.build(stack, "TestApi");
  return Template.fromStack(stack);
}

/** Adds a minimal root method so the API passes CDK validation. */
function withStubMethod(builder: ReturnType<typeof createRestApiBuilder>) {
  return builder.addMethod("GET", stubIntegration, methodResponse200);
}

describe("RestApiBuilder", () => {
  describe("build", () => {
    it("returns a RestApiBuilderResult with an api property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createRestApiBuilder();

      builder.restApiName("TestApi").addMethod("GET", stubIntegration, methodResponse200);

      const result = builder.build(stack, "TestApi");

      expect(result).toBeDefined();
      expect(result.api).toBeDefined();
    });

    it("returns the auto-created access log group in the result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createRestApiBuilder();

      withStubMethod(builder);

      const result = builder.build(stack, "TestApi");

      expect(result.accessLogGroup).toBeDefined();
    });

    it("returns undefined accessLogGroup when access logging is disabled", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createRestApiBuilder();

      withStubMethod(builder.accessLogging(false));

      const result = builder.build(stack, "TestApi");

      expect(result.accessLogGroup).toBeUndefined();
    });

    it("returns undefined accessLogGroup when user provides their own destination", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogGroup = new LogGroup(stack, "UserLogGroup");
      const builder = createRestApiBuilder();

      withStubMethod(
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
      const template = synthTemplate((b) => withStubMethod(b.restApiName("My Service")));

      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Name: "My Service",
      });
    });

    it("creates a REST API with a description", () => {
      const template = synthTemplate((b) =>
        withStubMethod(b.restApiName("My Service").description("A test API")),
      );

      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Name: "My Service",
        Description: "A test API",
      });
    });

    it("creates a single top-level resource", () => {
      const template = synthTemplate((b) =>
        withStubMethod(b.restApiName("My Service")).addResource("users"),
      );

      template.resourceCountIs("AWS::ApiGateway::Resource", 1);
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "users",
      });
    });

    it("creates a method on the root resource", () => {
      const integration = mockIntegration({ message: "hello" });

      const template = synthTemplate((b) =>
        b.restApiName("My Service").addMethod("GET", integration, methodResponse200),
      );

      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: "GET",
        Integration: {
          Type: "MOCK",
          PassthroughBehavior: "NEVER",
        },
      });
    });

    it("creates nested resources", () => {
      const template = synthTemplate((b) =>
        withStubMethod(b.restApiName("My Service")).addResource("users", (users) =>
          users.addResource("{id}"),
        ),
      );

      template.resourceCountIs("AWS::ApiGateway::Resource", 2);
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "users",
      });
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "{id}",
      });
    });

    it("creates methods on child resources", () => {
      const integration = mockIntegration({ users: [] });

      const template = synthTemplate((b) =>
        b
          .restApiName("My Service")
          .addResource("users", (users) => users.addMethod("GET", integration, methodResponse200)),
      );

      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: "GET",
        Integration: { Type: "MOCK" },
      });
    });

    it("creates multiple methods on the same resource", () => {
      const listIntegration = mockIntegration({ users: [] });
      const createIntegration = mockIntegration({ id: "new-user" });

      const template = synthTemplate((b) =>
        b
          .restApiName("My Service")
          .addResource("users", (users) =>
            users
              .addMethod("GET", listIntegration, methodResponse200)
              .addMethod("POST", createIntegration, methodResponse200),
          ),
      );

      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: "GET",
      });
      template.hasResourceProperties("AWS::ApiGateway::Method", {
        HttpMethod: "POST",
      });
    });

    it("creates multiple sibling resources", () => {
      const template = synthTemplate((b) =>
        withStubMethod(b.restApiName("My Service")).addResource("users").addResource("orders"),
      );

      template.resourceCountIs("AWS::ApiGateway::Resource", 2);
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "users",
      });
      template.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: "orders",
      });
    });

    it("creates a deeply nested resource tree", () => {
      const template = synthTemplate((b) =>
        withStubMethod(b.restApiName("My Service")).addResource("v1", (v1) =>
          v1.addResource("users", (users) =>
            users.addResource("{id}", (user) => user.addResource("orders")),
          ),
        ),
      );

      template.resourceCountIs("AWS::ApiGateway::Resource", 4);
      template.hasResourceProperties("AWS::ApiGateway::Resource", { PathPart: "v1" });
      template.hasResourceProperties("AWS::ApiGateway::Resource", { PathPart: "users" });
      template.hasResourceProperties("AWS::ApiGateway::Resource", { PathPart: "{id}" });
      template.hasResourceProperties("AWS::ApiGateway::Resource", { PathPart: "orders" });
    });

    it("creates a deployment and stage by default", () => {
      const template = synthTemplate((b) => withStubMethod(b.restApiName("My Service")));

      template.resourceCountIs("AWS::ApiGateway::Deployment", 1);
      template.resourceCountIs("AWS::ApiGateway::Stage", 1);
    });

    it("creates exactly one REST API", () => {
      const template = synthTemplate((b) =>
        b
          .restApiName("My Service")
          .addResource("users", (users) =>
            users
              .addMethod("GET", mockIntegration({ users: [] }), methodResponse200)
              .addResource("{id}", (user) =>
                user.addMethod("GET", mockIntegration({ id: "1" }), methodResponse200),
              ),
          ),
      );

      template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    });
  });

  describe("secure defaults", () => {
    it("enables X-Ray tracing on the stage by default", () => {
      const template = synthTemplate((b) => withStubMethod(b));

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        TracingEnabled: true,
      });
    });

    it("enables CloudWatch execution logging by default", () => {
      const template = synthTemplate((b) => withStubMethod(b));

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: Match.arrayWith([Match.objectLike({ LoggingLevel: "INFO" })]),
      });
    });

    it("creates an access log group by default", () => {
      const template = synthTemplate((b) => withStubMethod(b));

      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 731,
      });
    });

    it("configures access log destination on the stage by default", () => {
      const template = synthTemplate((b) => withStubMethod(b));

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        AccessLogSetting: {
          DestinationArn: Match.anyValue(),
        },
      });
    });

    it("allows the user to override tracing", () => {
      const template = synthTemplate((b) =>
        withStubMethod(b.deployOptions({ tracingEnabled: false })),
      );

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        TracingEnabled: false,
      });
    });

    it("allows the user to override logging level", () => {
      const template = synthTemplate((b) =>
        withStubMethod(b.deployOptions({ loggingLevel: MethodLoggingLevel.ERROR })),
      );

      template.hasResourceProperties("AWS::ApiGateway::Stage", {
        MethodSettings: Match.arrayWith([Match.objectLike({ LoggingLevel: "ERROR" })]),
      });
    });

    it("skips auto log group when user provides their own access log destination", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogGroup = new LogGroup(stack, "UserLogGroup");
      const builder = createRestApiBuilder();
      withStubMethod(
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
      const template = synthTemplate((b) => withStubMethod(b.accessLogging(false)));

      template.resourceCountIs("AWS::Logs::LogGroup", 0);
    });

    it("preserves user deployOptions while applying defaults for missing fields", () => {
      const template = synthTemplate((b) => withStubMethod(b.deployOptions({ stageName: "live" })));

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
