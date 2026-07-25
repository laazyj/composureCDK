import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { RestApi } from "aws-cdk-lib/aws-apigateway";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ref } from "@composurecdk/core";
import { restApiGrants } from "../src/grants.js";

function setup() {
  const app = new App();
  const stack = new Stack(app, "S");
  const api = new RestApi(stack, "Api");
  api.root.addMethod("GET");
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, api, role };
}

// The granted action lands on the role's policy; asserting on the rendered
// template keeps us decoupled from CDK's exact statement shape.
const policyJson = (stack: Stack) => JSON.stringify(Template.fromStack(stack).toJSON());

describe("restApiGrants", () => {
  it("invoke grants execute-api:Invoke across the whole API by default", () => {
    const { stack, api, role } = setup();

    restApiGrants.invoke(api).applyTo(role, {});

    const json = policyJson(stack);
    expect(json).toContain("execute-api:Invoke");
    // arnForExecuteApi() with no scope resolves to .../*/*/* (any method/path/stage).
    expect(json).toContain("/*/*/*");
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("invoke narrows the resource ARN to a given method, path, and stage", () => {
    const { stack, api, role } = setup();

    restApiGrants.invoke(api, { method: "GET", path: "/items", stage: "prod" }).applyTo(role, {});

    const json = policyJson(stack);
    expect(json).toContain("execute-api:Invoke");
    expect(json).toContain("/prod/GET/items");
  });

  it("resolves a Resolvable API from the build context before granting", () => {
    const { stack, api, role } = setup();

    restApiGrants
      .invoke(ref<{ api: RestApi }, RestApi>("gateway", (r) => r.api))
      .applyTo(role, { gateway: { api } });

    expect(policyJson(stack)).toContain("execute-api:Invoke");
  });
});
