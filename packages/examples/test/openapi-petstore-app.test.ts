import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createOpenApiPetstoreApp } from "../src/openapi-petstore-app.js";

describe("openapi-petstore-app", () => {
  const { stack } = createOpenApiPetstoreApp();
  const template = Template.fromStack(stack);

  it("creates one REST API", () => {
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
  });

  it("creates the REST API with the PetStore name", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "PetStore",
    });
  });

  it("embeds the OpenAPI specification in the template body", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Body: {
        openapi: "3.0.2",
        info: { title: "PetStore", version: "1.0" },
      },
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
