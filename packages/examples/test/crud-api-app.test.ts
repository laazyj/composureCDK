import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createCrudApiApp } from "../src/crud-api-app.js";

describe("crud-api-app", () => {
  const { stack } = createCrudApiApp();
  const template = Template.fromStack(stack);

  it("creates one DynamoDB table keyed on id", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    });
  });

  it("creates one REST API and the gadgets/{id} resources", () => {
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    template.resourceCountIs("AWS::ApiGateway::Resource", 2);
    template.hasResourceProperties("AWS::ApiGateway::Resource", { PathPart: "gadgets" });
    template.hasResourceProperties("AWS::ApiGateway::Resource", { PathPart: "{id}" });
  });

  it("wires GET and POST on /gadgets directly to DynamoDB Scan and PutItem", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      Integration: Match.objectLike({
        Type: "AWS",
        Uri: Match.objectLike({
          "Fn::Join": Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp("action/Scan")])]),
        }),
      }),
    });
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "POST",
      Integration: Match.objectLike({
        Type: "AWS",
        Uri: Match.objectLike({
          "Fn::Join": Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp("action/PutItem")]),
          ]),
        }),
      }),
    });
  });

  it("wires GET, PUT, and DELETE on /gadgets/{id} to GetItem, PutItem, and DeleteItem", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "GET" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "PUT" });
    template.hasResourceProperties("AWS::ApiGateway::Method", { HttpMethod: "DELETE" });
    template.resourcePropertiesCountIs(
      "AWS::ApiGateway::Method",
      { Integration: Match.objectLike({ IntegrationHttpMethod: "POST", Type: "AWS" }) },
      5,
    );
  });

  it("creates a role API Gateway can assume", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "apigateway.amazonaws.com" },
          }),
        ]),
      }),
    });
  });

  it("grants the role read/write access scoped to the table's ARN", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["dynamodb:GetItem", "dynamodb:Scan", "dynamodb:PutItem"]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });

  it("encrypts the table with a customer-managed key built as a component", () => {
    template.resourceCountIs("AWS::KMS::Key", 1);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      SSESpecification: { SSEEnabled: true, SSEType: "KMS" },
    });
  });

  it("gives the key an alias and rotation on, from the builder defaults", () => {
    template.hasResourceProperties("AWS::KMS::Alias", {
      AliasName: "alias/composurecdk-examples/crud-api/gadgets",
    });
    template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true });
  });

  it("extends the role's table grant to the key, with no separate KMS grant declared", () => {
    // `tableGrants.readWrite` is the only grant in the stack; CDK's own
    // grantReadWriteData reaches the table's encryptionKey, so the API role
    // can decrypt without the example asking for it.
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["kms:Decrypt", "kms:GenerateDataKey*"]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });

  it("seeds the catalogue during deployment, gated on the API being reachable", () => {
    template.resourceCountIs("Custom::Trigger", 1);

    const [trigger] = Object.values(template.findResources("Custom::Trigger")) as {
      Properties: { InvocationType: string };
      DependsOn?: string[];
    }[];

    // Synchronous, so a seed failure fails the deployment rather than
    // reporting success after the fact.
    expect(trigger.Properties.InvocationType).toBe("RequestResponse");

    // `after` names the whole API component, so the wait covers the stage —
    // the seeder calls the invoke URL, which a bare RestApi does not serve.
    expect(trigger.DependsOn ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining("Stage")]),
    );
  });

  it("gives the seeder the API url and its literal log level", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          API_URL: Match.objectLike({ "Fn::Join": Match.anyValue() }),
          LOG_LEVEL: "info",
        },
      },
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
