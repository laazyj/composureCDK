import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ContentHandling, PassthroughBehavior } from "aws-cdk-lib/aws-apigateway";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type Grant, grantVia, ref, type Resolvable } from "@composurecdk/core";
import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { createRestApiBuilder, type RestApiBuilderResult } from "../src/rest-api-builder.js";
import { awsServiceIntegration } from "../src/aws-service-integration.js";

const methodResponse200 = { methodResponses: [{ statusCode: "200" }] };

/** Local stand-in for `@composurecdk/dynamodb`'s `tableGrants.read` (avoids the cross-package dev dep). */
function tableReadGrant(table: Resolvable<ITable>): Grant<IGrantable> {
  return grantVia(table, (t: ITable, g: IGrantable) => {
    t.grantReadData(g);
  });
}

function buildInStack(
  configure: (builder: ReturnType<typeof createRestApiBuilder>) => void,
  context?: Record<string, object>,
): { template: Template; result: RestApiBuilderResult; stack: Stack } {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createRestApiBuilder().restApiName("TestApi");
  configure(builder);
  const result = builder.build(stack, "TestApi", context ?? {});
  return { template: Template.fromStack(stack), result, stack };
}

describe("awsServiceIntegration", () => {
  it("synthesizes an AWS integration whose credentials point at an owned role", () => {
    const { template, result } = buildInStack((builder) =>
      builder.addResource("gadgets", (g) =>
        g.addMethod(
          "GET",
          awsServiceIntegration("dynamodb", "Scan").requestTemplates({
            "application/json": "{}",
          }),
          methodResponse200,
        ),
      ),
    );

    template.hasResourceProperties("AWS::ApiGateway::Method", {
      Integration: Match.objectLike({
        Type: "AWS",
        IntegrationHttpMethod: "POST",
        Credentials: Match.anyValue(),
      }),
    });
    // The integration owns exactly one credentials role (the account-level
    // CloudWatch role API Gateway auto-creates is separate).
    expect(Object.keys(result.integrationRoles)).toEqual(["/gadgets GET"]);
  });

  it("restricts the credentials role to the owning API by default (confused-deputy)", () => {
    const { template } = buildInStack((builder) =>
      builder.addResource("gadgets", (g) =>
        g.addMethod("GET", awsServiceIntegration("dynamodb", "Scan"), methodResponse200),
      ),
    );

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "apigateway.amazonaws.com" },
            Condition: { ArnLike: { "aws:SourceArn": Match.anyValue() } },
          }),
        ]),
      }),
    });
  });

  it("omits the SourceArn condition when restrictToApi(false)", () => {
    const { template } = buildInStack((builder) =>
      builder.addResource("gadgets", (g) =>
        g.addMethod(
          "GET",
          awsServiceIntegration("dynamodb", "Scan").restrictToApi(false),
          methodResponse200,
        ),
      ),
    );

    const roles = template.findResources("AWS::IAM::Role") as Record<
      string,
      { Properties: { AssumeRolePolicyDocument: { Statement: { Condition?: unknown }[] } } }
    >;
    const statements = Object.values(roles).flatMap(
      (r) => r.Properties.AssumeRolePolicyDocument.Statement,
    );
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s.Condition).toBeUndefined();
    }
  });

  it("surfaces the owned role on result.integrationRoles keyed by path and method", () => {
    const { result } = buildInStack((builder) =>
      builder.addResource("gadgets", (g) =>
        g.addMethod("GET", awsServiceIntegration("dynamodb", "Scan"), methodResponse200),
      ),
    );

    expect(Object.keys(result.integrationRoles)).toEqual(["/gadgets GET"]);
    expect(result.integrationRoles["/gadgets GET"]).toBeDefined();
  });

  it('keys a root-level AWS-service integration by "/ GET"', () => {
    const { result } = buildInStack((builder) =>
      builder.addMethod(
        "GET",
        awsServiceIntegration("dynamodb", "Scan").restrictToApi(false),
        methodResponse200,
      ),
    );
    expect(result.integrationRoles["/ GET"]).toBeDefined();
  });

  it("applies a consumer-side grant to the owned role, resolving the resource ref", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    const scan = awsServiceIntegration("dynamodb", "Scan")
      .requestTemplates(
        ref("table", (r: { table: ITable }) => ({
          "application/json": `{"TableName":"${r.table.tableName}"}`,
        })),
      )
      .grant(tableReadGrant(ref("table", (r: { table: ITable }) => r.table)));

    const builder = createRestApiBuilder()
      .restApiName("TestApi")
      .addResource("gadgets", (g) => g.addMethod("GET", scan, methodResponse200));

    builder.build(stack, "TestApi", { table: { table } });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["dynamodb:GetItem", "dynamodb:Scan"]),
          }),
        ]),
      }),
    });
  });

  it("applies all fluent integration options onto the AwsIntegration", () => {
    const { template } = buildInStack((builder) =>
      builder.addResource("gadgets", (g) =>
        g.addMethod(
          "GET",
          awsServiceIntegration("dynamodb", "Scan")
            .requestParameters({
              "integration.request.header.X-Amz-Target": "'DynamoDB_20120810.Scan'",
            })
            .integrationResponses([{ statusCode: "200" }])
            .passthroughBehavior(PassthroughBehavior.NEVER)
            .options({ contentHandling: ContentHandling.CONVERT_TO_TEXT })
            .configure((p) => {
              p.integrationHttpMethod = "GET";
              p.region = "us-west-2";
            }),
          methodResponse200,
        ),
      ),
    );

    template.hasResourceProperties("AWS::ApiGateway::Method", {
      Integration: Match.objectLike({
        IntegrationHttpMethod: "GET",
        PassthroughBehavior: "NEVER",
        ContentHandling: "CONVERT_TO_TEXT",
        RequestParameters: {
          "integration.request.header.X-Amz-Target": "'DynamoDB_20120810.Scan'",
        },
        IntegrationResponses: Match.arrayWith([Match.objectLike({ StatusCode: "200" })]),
      }),
    });
  });

  it("configureRole extends the owned credentials role", () => {
    const { template } = buildInStack((builder) =>
      builder.addResource("gadgets", (g) =>
        g.addMethod(
          "GET",
          awsServiceIntegration("dynamodb", "Scan").configureRole((rb) =>
            rb.description("custom creds role"),
          ),
          methodResponse200,
        ),
      ),
    );

    template.hasResourceProperties("AWS::IAM::Role", {
      Description: "custom creds role",
    });
  });

  it("uses an external role and creates no credentials role of its own", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const external = new Role(stack, "External", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
    });

    const builder = createRestApiBuilder()
      .restApiName("TestApi")
      .addResource("gadgets", (g) =>
        g.addMethod(
          "GET",
          awsServiceIntegration("dynamodb", "Scan").role(
            ref("shared", (r: { role: Role }) => r.role),
          ),
          methodResponse200,
        ),
      );

    const result = builder.build(stack, "TestApi", { shared: { role: external } });

    // build() only creates a role when none is supplied, so returning the
    // external role proves the integration created none of its own.
    expect(result.integrationRoles["/gadgets GET"]).toBe(external);
  });

  it("throws when both .role() and .configureRole() are set", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const external = new Role(stack, "External", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
    });

    const builder = createRestApiBuilder()
      .restApiName("TestApi")
      .addResource("gadgets", (g) =>
        g.addMethod(
          "GET",
          awsServiceIntegration("dynamodb", "Scan")
            .role(external)
            .configureRole((rb) => rb.description("x")),
          methodResponse200,
        ),
      );

    expect(() => builder.build(stack, "TestApi", {})).toThrow(/mutually exclusive/);
  });

  it("throws a descriptive error when a grant ref is not in the context", () => {
    const builder = createRestApiBuilder()
      .restApiName("TestApi")
      .addResource("gadgets", (g) =>
        g.addMethod(
          "GET",
          awsServiceIntegration("dynamodb", "Scan").grant(
            tableReadGrant(ref("table", (r: { table: ITable }) => r.table)),
          ),
          methodResponse200,
        ),
      );

    const app = new App();
    const stack = new Stack(app, "TestStack");
    expect(() => builder.build(stack, "TestApi", {})).toThrow(/table/);
  });

  it("shares the integration instance across .copy() and builds independent roles", () => {
    const scan = awsServiceIntegration("dynamodb", "Scan");
    const base = createRestApiBuilder()
      .restApiName("TestApi")
      .addResource("gadgets", (g) => g.addMethod("GET", scan, methodResponse200));

    const app = new App();
    const stackA = new Stack(app, "StackA");
    const stackB = new Stack(app, "StackB");
    const resultA = base.build(stackA, "ApiA", {});
    const resultB = base.copy().build(stackB, "ApiB", {});

    const roleA = resultA.integrationRoles["/gadgets GET"];
    const roleB = resultB.integrationRoles["/gadgets GET"];
    expect(roleA).toBeDefined();
    expect(roleB).toBeDefined();
    // Same shared builder instance, but each build() creates its own role.
    expect(roleA).not.toBe(roleB);
  });
});
