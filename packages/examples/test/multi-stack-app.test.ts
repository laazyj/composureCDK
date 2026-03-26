import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createMultiStackApp } from "../src/multi-stack-app.js";

describe("multi-stack-app", () => {
  const { serviceStack, apiStack } = createMultiStackApp();
  const serviceTemplate = Template.fromStack(serviceStack);
  const apiTemplate = Template.fromStack(apiStack);

  it("places the Lambda in the service stack", () => {
    serviceTemplate.resourceCountIs("AWS::Lambda::Function", 1);
    apiTemplate.resourceCountIs("AWS::Lambda::Function", 0);
  });

  it("places the REST API in the api stack", () => {
    apiTemplate.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    serviceTemplate.resourceCountIs("AWS::ApiGateway::RestApi", 0);
  });

  it("creates a cross-stack reference for the Lambda", () => {
    // CDK exports the Lambda ARN from the service stack
    const serviceOutputs = serviceTemplate.findOutputs("*");
    expect(Object.keys(serviceOutputs).length).toBeGreaterThan(0);
  });

  it("matches the expected service stack template", () => {
    expect(serviceTemplate.toJSON()).toMatchSnapshot();
  });

  it("matches the expected api stack template", () => {
    expect(apiTemplate.toJSON()).toMatchSnapshot();
  });
});
