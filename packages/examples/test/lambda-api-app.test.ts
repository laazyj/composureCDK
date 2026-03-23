import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { createLambdaApiApp } from "../src/lambda-api-app.js";

function synthTemplate(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const system = createLambdaApiApp();
  system.build(stack, "LambdaApiApp");
  return Template.fromStack(stack);
}

describe("lambda-api-app", () => {
  it("creates one REST API", () => {
    const template = synthTemplate();

    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
  });

  it("creates one Lambda function", () => {
    const template = synthTemplate();

    template.resourceCountIs("AWS::Lambda::Function", 1);
  });

  it("creates the users and {id} resources", () => {
    const template = synthTemplate();

    template.resourceCountIs("AWS::ApiGateway::Resource", 2);
    template.hasResourceProperties("AWS::ApiGateway::Resource", {
      PathPart: "users",
    });
    template.hasResourceProperties("AWS::ApiGateway::Resource", {
      PathPart: "{id}",
    });
  });

  it("wires methods with AWS_PROXY Lambda integration", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      Integration: {
        Type: "AWS_PROXY",
      },
    });
  });

  it("grants API Gateway permission to invoke the Lambda", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "apigateway.amazonaws.com",
    });
  });

  it("matches the expected synthesised template", () => {
    const template = synthTemplate();

    expect(template.toJSON()).toMatchSnapshot();
  });
});
