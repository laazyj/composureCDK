import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createLambdaApiApp } from "../src/lambda-api-app.js";

describe("lambda-api-app", () => {
  const { stack } = createLambdaApiApp();
  const template = Template.fromStack(stack);

  it("creates one REST API", () => {
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
  });

  it("creates one Lambda function", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
  });

  it("creates the users and {id} resources", () => {
    template.resourceCountIs("AWS::ApiGateway::Resource", 2);
    template.hasResourceProperties("AWS::ApiGateway::Resource", {
      PathPart: "users",
    });
    template.hasResourceProperties("AWS::ApiGateway::Resource", {
      PathPart: "{id}",
    });
  });

  it("wires methods with AWS_PROXY Lambda integration", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      Integration: {
        Type: "AWS_PROXY",
      },
    });
  });

  it("grants API Gateway permission to invoke the Lambda", () => {
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "apigateway.amazonaws.com",
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
