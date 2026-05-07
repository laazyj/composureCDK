import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createDualFunctionApp } from "../src/dual-function-app.js";

describe("dual-function-app", () => {
  const { stack } = createDualFunctionApp();
  const template = Template.fromStack(stack);

  it("creates two Lambda functions", () => {
    template.resourceCountIs("AWS::Lambda::Function", 2);
  });

  it("creates two IAM execution roles", () => {
    template.resourceCountIs("AWS::IAM::Role", 2);
  });

  it("configures the API handler", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 256,
      Timeout: 30,
      TracingConfig: { Mode: "Active" },
      Description: "API handler — receives and validates incoming requests",
    });
  });

  it("configures the worker", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 512,
      Timeout: 300,
      TracingConfig: { Mode: "Active" },
      Description: "Worker — processes requests asynchronously",
    });
  });

  it("schedules the worker every 15 minutes via an EventBridge rule", () => {
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(15 minutes)",
      Description: "Tick the worker every 15 minutes",
      Targets: Match.arrayWith([Match.objectLike({ Id: "Target0" })]),
    });
  });

  it("grants EventBridge permission to invoke the worker", () => {
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
    });
  });

  it("creates the four AWS-recommended rule alarms", () => {
    template.resourcePropertiesCountIs("AWS::CloudWatch::Alarm", { Namespace: "AWS/Events" }, 4);
    for (const metricName of [
      "FailedInvocations",
      "ThrottledRules",
      "InvocationsSentToDlq",
      "InvocationsFailedToBeSentToDlq",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/Events",
        MetricName: metricName,
      });
    }
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
