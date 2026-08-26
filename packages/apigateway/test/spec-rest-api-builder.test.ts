import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  ApiDefinition,
  LogGroupLogDestination,
  MethodLoggingLevel,
  type RestApiBase,
  type SpecRestApiProps,
} from "aws-cdk-lib/aws-apigateway";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { combine, compose, type Lifecycle, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import {
  createSpecRestApiBuilder,
  type SpecRestApiBuilderProps,
} from "../src/spec-rest-api-builder.js";

/** Minimal OpenAPI 3.0 spec with a single GET /pets endpoint, mock-integrated
 * unless the caller supplies an integration of its own. */
function minimalOpenApiSpec(
  integration: object = {
    type: "MOCK",
    requestTemplates: { "application/json": '{ "statusCode": 200 }' },
    responses: { default: { statusCode: "200" } },
  },
) {
  return {
    openapi: "3.0.2",
    info: { title: "TestApi", version: "1.0" },
    paths: {
      "/pets": {
        get: {
          responses: { "200": { description: "OK" } },
          "x-amazon-apigateway-integration": integration,
        },
      },
    },
  };
}

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createSpecRestApiBuilder>) => void,
  context?: Record<string, object>,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createSpecRestApiBuilder();
  configureFn(builder);
  builder.build(stack, "TestApi", context);
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

  describe("props", () => {
    it("accept everything CDK's own SpecRestApiProps accepts (type-level guard)", () => {
      // A re-declared prop must accept everything CDK's own prop accepts, so a
      // later re-declaration cannot silently narrow the builder's surface
      // (ADR-0018). A `tsc`-only assertion — vitest does not typecheck.
      const props: SpecRestApiBuilderProps = undefined as unknown as SpecRestApiProps;
      void props;
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

  describe("resolvable apiDefinition", () => {
    const HANDLER_ARN = "arn:aws:lambda:us-east-1:123456789012:function:Handler";
    const ROLE_ARN = "arn:aws:iam::123456789012:role/GatewayRole";

    /** Asserts the synthesised `Body` carries the given integration fields. */
    function expectIntegration(template: Template, integration: Record<string, unknown>) {
      template.hasResourceProperties("AWS::ApiGateway::RestApi", {
        Body: Match.objectLike({
          paths: {
            "/pets": {
              get: { "x-amazon-apigateway-integration": Match.objectLike(integration) },
            },
          },
        }),
      });
    }

    it("resolves a ref against the build context", () => {
      const template = synthTemplate(
        (b) =>
          b
            .restApiName("My Service")
            .apiDefinition(
              ref("handler", (r: { functionArn: string }) =>
                ApiDefinition.fromInline(
                  minimalOpenApiSpec({ type: "AWS_PROXY", uri: r.functionArn }),
                ),
              ),
            ),
        { handler: { functionArn: HANDLER_ARN } },
      );

      expectIntegration(template, { uri: HANDLER_ARN });
    });

    it("resolves a combine of several siblings into one definition", () => {
      const template = synthTemplate(
        (b) =>
          b.restApiName("My Service").apiDefinition(
            combine(
              {
                handler: ref<{ functionArn: string }>("handler"),
                gatewayRole: ref<{ roleArn: string }>("gatewayRole"),
              },
              ({ handler, gatewayRole }) =>
                ApiDefinition.fromInline(
                  minimalOpenApiSpec({
                    type: "AWS_PROXY",
                    uri: handler.functionArn,
                    credentials: gatewayRole.roleArn,
                  }),
                ),
            ),
          ),
        {
          handler: { functionArn: HANDLER_ARN },
          gatewayRole: { roleArn: ROLE_ARN },
        },
      );

      expectIntegration(template, { uri: HANDLER_ARN, credentials: ROLE_ARN });
    });

    it("carries a CDK token from a sibling into the synthesised body", () => {
      const stack = new Stack(new App(), "TestStack");
      const sibling = new LogGroup(stack, "SiblingLogGroup");
      const builder = createSpecRestApiBuilder()
        .restApiName("My Service")
        .apiDefinition(
          ref("sibling", (r: { arn: string }) =>
            ApiDefinition.fromInline(
              minimalOpenApiSpec({ type: "AWS_PROXY", uri: `${r.arn}/invoke` }),
            ),
          ),
        );

      builder.build(stack, "TestApi", { sibling: { arn: sibling.logGroupArn } });

      // An unresolved token would stringify to "${Token[...]}"; a Fn::Join
      // proves the sibling's Fn::GetAtt survived into the API body.
      expectIntegration(Template.fromStack(stack), { uri: { "Fn::Join": Match.anyValue() } });
    });

    it("throws when a ref names a component that is not a dependency", () => {
      const stack = new Stack(new App(), "TestStack");
      const builder = createSpecRestApiBuilder()
        .restApiName("My Service")
        .apiDefinition(
          ref("handler", (r: { functionArn: string }) =>
            ApiDefinition.fromInline(minimalOpenApiSpec({ uri: r.functionArn })),
          ),
        );

      expect(() => builder.build(stack, "TestApi")).toThrow(
        /"handler" cannot be resolved: component not found in context/,
      );
    });

    it("throws a descriptive error when no apiDefinition is set", () => {
      const stack = new Stack(new App(), "TestStack");
      const builder = createSpecRestApiBuilder().restApiName("My Service");

      expect(() => builder.build(stack, "TestApi")).toThrow(/requires an apiDefinition/);
    });

    it("resolves against a sibling built by compose", () => {
      const stack = new Stack(new App(), "TestStack");
      const handler: Lifecycle<{ functionArn: string }> = {
        build: () => ({ functionArn: HANDLER_ARN }),
      };

      compose(
        {
          handler,
          api: createSpecRestApiBuilder()
            .restApiName("My Service")
            .apiDefinition(
              ref("handler", (r: { functionArn: string }) =>
                ApiDefinition.fromInline(
                  minimalOpenApiSpec({ type: "AWS_PROXY", uri: r.functionArn }),
                ),
              ),
            ),
        },
        { handler: [], api: ["handler"] },
      ).build(stack, "System");

      expectIntegration(Template.fromStack(stack), { uri: HANDLER_ARN });
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

  describe("[COPY_STATE]", () => {
    it("preserves #customAlarms across .copy()", () => {
      const errorMetric = (api: RestApiBase): Metric =>
        new Metric({
          namespace: "AWS/ApiGateway",
          metricName: "5XXError",
          dimensionsMap: { ApiName: api.restApiName },
          statistic: "Sum",
          period: Duration.minutes(1),
        });

      assertCopyPreservesState({
        factory: () =>
          createSpecRestApiBuilder().apiDefinition(ApiDefinition.fromInline(minimalOpenApiSpec())),
        configure: (b) => {
          b.addAlarm("firstCustom", (alarm) =>
            alarm.metric(errorMetric).threshold(1).greaterThanOrEqual(),
          );
        },
        mutate: (b) => {
          b.addAlarm("secondCustom", (alarm) =>
            alarm.metric(errorMetric).threshold(5).greaterThanOrEqual(),
          );
        },
        build: (b) => {
          const stack = new Stack(new App(), "S");
          return b.build(stack, "Api");
        },
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
