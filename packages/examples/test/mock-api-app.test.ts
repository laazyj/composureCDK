import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { createMockApiApp } from "../src/mock-api-app.js";

function synthTemplate(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const system = createMockApiApp();
  system.build(stack, "MockApiApp");
  return Template.fromStack(stack);
}

describe("mock-api-app", () => {
  it("creates one REST API", () => {
    const template = synthTemplate();

    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
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

  it("creates methods on the root resource", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      Integration: { Type: "MOCK" },
    });
  });

  it("creates GET and POST on /users", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "GET" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "POST" });
  });

  it("creates GET, PUT, and DELETE on /users/{id}", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "GET" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "PUT" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "DELETE" });
  });

  it("matches the expected synthesised template", () => {
    const template = synthTemplate();

    expect(template.toJSON()).toMatchSnapshot();
  });
});
