import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createMockApiApp } from "../src/mock-api-app.js";

describe("mock-api-app", () => {
  const { stack } = createMockApiApp();
  const template = Template.fromStack(stack);

  it("creates one REST API", () => {
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
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

  it("creates methods on the root resource", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      Integration: { Type: "MOCK" },
    });
  });

  it("creates GET and POST on /users", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "GET" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "POST" });
  });

  it("creates GET, PUT, and DELETE on /users/{id}", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "GET" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "PUT" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "DELETE" });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
