import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
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
      Body: Match.objectLike({
        openapi: "3.0.2",
        info: { title: "PetStore", version: "1.0" },
      }),
    });
  });

  it("creates the handler and the role API Gateway assumes to invoke it", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRole",
            Principal: { Service: "apigateway.amazonaws.com" },
          }),
        ]),
      }),
    });
  });

  it("resolves the spec placeholders to the sibling handler and role", () => {
    // A placeholder left unsubstituted would still be a plain string; the
    // intrinsics prove the siblings' ARNs reached the API body.
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Body: Match.objectLike({
        paths: {
          "/pets/{petId}": {
            get: {
              "x-amazon-apigateway-integration": {
                uri: { "Fn::Join": Match.anyValue() },
                credentials: { "Fn::GetAtt": Match.anyValue() },
              },
            },
          },
        },
      }),
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
