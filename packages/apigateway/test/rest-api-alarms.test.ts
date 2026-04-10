import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ApiDefinition, MockIntegration, PassthroughBehavior } from "aws-cdk-lib/aws-apigateway";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { createRestApiBuilder } from "../src/rest-api-builder.js";
import { createSpecRestApiBuilder } from "../src/spec-rest-api-builder.js";

function mockIntegration() {
  return new MockIntegration({
    integrationResponses: [
      {
        statusCode: "200",
        responseTemplates: { "application/json": '{ "ok": true }' },
      },
    ],
    passthroughBehavior: PassthroughBehavior.NEVER,
    requestTemplates: { "application/json": '{ "statusCode": 200 }' },
  });
}

const methodResponse200 = { methodResponses: [{ statusCode: "200" }] };

function buildResult(configureFn: (builder: ReturnType<typeof createRestApiBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createRestApiBuilder();
  configureFn(builder);
  const result = builder.build(stack, "TestApi");
  return { result, template: Template.fromStack(stack) };
}

function withStubMethod(builder: ReturnType<typeof createRestApiBuilder>) {
  builder.addMethod("GET", mockIntegration(), methodResponse200);
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates clientError, serverError, and latency alarms by default", () => {
      const { result, template } = buildResult(withStubMethod);

      expect(result.alarms.clientError).toBeDefined();
      expect(result.alarms.serverError).toBeDefined();
      expect(result.alarms.latency).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("creates clientError alarm with threshold > 0.05", () => {
      const { template } = buildResult(withStubMethod);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4XXError",
        Namespace: "AWS/ApiGateway",
        Threshold: 0.05,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 5,
        TreatMissingData: "notBreaching",
        Statistic: "Average",
        Period: 60,
      });
    });

    it("creates serverError alarm with threshold > 0.05", () => {
      const { template } = buildResult(withStubMethod);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5XXError",
        Namespace: "AWS/ApiGateway",
        Threshold: 0.05,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
        TreatMissingData: "notBreaching",
        Statistic: "Average",
        Period: 60,
      });
    });

    it("creates latency alarm with threshold >= 2500ms", () => {
      const { template } = buildResult(withStubMethod);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Latency",
        Namespace: "AWS/ApiGateway",
        Threshold: 2500,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 5,
        TreatMissingData: "notBreaching",
        ExtendedStatistic: "p90",
        Period: 60,
      });
    });

    it("includes ApiName and Stage dimensions", () => {
      const { template } = buildResult(withStubMethod);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4XXError",
        Dimensions: Match.arrayWith([
          Match.objectLike({ Name: "ApiName" }),
          Match.objectLike({ Name: "Stage" }),
        ]),
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildResult(withStubMethod);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5XXError",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 5%"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing clientError alarm threshold", () => {
      const { template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms({ clientError: { threshold: 0.1 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4XXError",
        Threshold: 0.1,
      });
    });

    it("allows customizing latency threshold", () => {
      const { template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms({ latency: { threshold: 1000 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Latency",
        Threshold: 1000,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms({
          serverError: { evaluationPeriods: 5, datapointsToAlarm: 3 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5XXError",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 3,
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms({
          clientError: { treatMissingData: TreatMissingData.BREACHING },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4XXError",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms({ clientError: false });
      });

      expect(result.alarms.clientError).toBeUndefined();
      expect(result.alarms.serverError).toBeDefined();
      expect(result.alarms.latency).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("disables multiple individual alarms", () => {
      const { result, template } = buildResult((b) => {
        withStubMethod(b);
        b.recommendedAlarms({ clientError: false, serverError: false });
      });

      expect(result.alarms.clientError).toBeUndefined();
      expect(result.alarms.serverError).toBeUndefined();
      expect(result.alarms.latency).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildResult(withStubMethod);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4XXError",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildResult((b) => {
      withStubMethod(b);
      b.addAlarm("integrationLatency", (alarm) =>
        alarm
          .metric(
            (api) =>
              new Metric({
                namespace: "AWS/ApiGateway",
                metricName: "IntegrationLatency",
                dimensionsMap: {
                  ApiName: api.restApiName,
                  Stage: api.deploymentStage.stageName,
                },
                statistic: "p90",
                period: Duration.minutes(1),
              }),
          )
          .threshold(2000)
          .greaterThanOrEqual()
          .description("Integration latency is elevated"),
      );
    });

    expect(result.alarms.clientError).toBeDefined();
    expect(result.alarms.serverError).toBeDefined();
    expect(result.alarms.latency).toBeDefined();
    expect(result.alarms.integrationLatency).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
  });

  it("throws on duplicate key with recommended alarm", () => {
    expect(() =>
      buildResult((b) => {
        withStubMethod(b);
        b.addAlarm("serverError", (alarm) =>
          alarm
            .metric(
              (api) =>
                new Metric({
                  namespace: "AWS/ApiGateway",
                  metricName: "5XXError",
                  dimensionsMap: { ApiName: api.restApiName },
                  period: Duration.minutes(1),
                }),
            )
            .description("Duplicate"),
        );
      }),
    ).toThrow(/Duplicate alarm key "serverError"/);
  });
});

describe("SpecRestApiBuilder alarms", () => {
  it("creates recommended alarms for spec-driven REST API", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const builder = createSpecRestApiBuilder();

    builder.restApiName("TestSpecApi").apiDefinition(
      ApiDefinition.fromInline({
        openapi: "3.0.2",
        info: { title: "Test", version: "1.0" },
        paths: {
          "/pets": {
            get: {
              "x-amazon-apigateway-integration": {
                type: "MOCK",
                requestTemplates: { "application/json": '{ "statusCode": 200 }' },
                integrationResponses: [
                  {
                    statusCode: "200",
                    responseTemplates: { "application/json": "[]" },
                  },
                ],
              },
              responses: { "200": { description: "OK" } },
            },
          },
        },
      }),
    );

    const result = builder.build(stack, "TestSpecApi");
    const template = Template.fromStack(stack);

    expect(result.alarms.clientError).toBeDefined();
    expect(result.alarms.serverError).toBeDefined();
    expect(result.alarms.latency).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });
});
