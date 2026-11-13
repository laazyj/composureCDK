import { describe, it, expect } from "vitest";
import { Match, type Template } from "aws-cdk-lib/assertions";
import { ApiDefinition, MockIntegration } from "aws-cdk-lib/aws-apigateway";
import { AnyPrincipal, Effect, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { type IConstruct } from "constructs";
import { buildFixture } from "@composurecdk/cdk-testing";
import { ref, type Resolvable } from "@composurecdk/core";
import { createRestApiBuilder } from "../src/rest-api-builder.js";
import { createSpecRestApiBuilder } from "../src/spec-rest-api-builder.js";

const SOURCE_VPCE = "vpce-0123456789abcdef0";

/** A policy denying any caller outside `vpce`. */
function denyOutsideVpce(vpce: string) {
  return new PolicyDocument({
    statements: [
      new PolicyStatement({
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ["execute-api:Invoke"],
        resources: ["execute-api:/*"],
        conditions: { StringNotEquals: { "aws:SourceVpce": vpce } },
      }),
    ],
  });
}

const DENY_OUTSIDE_VPCE = {
  Policy: {
    Statement: [
      Match.objectLike({
        Effect: "Deny",
        Principal: { AWS: "*" },
        Action: "execute-api:Invoke",
        Resource: "execute-api:/*",
        Condition: { StringNotEquals: { "aws:SourceVpce": SOURCE_VPCE } },
      }),
    ],
  },
};

/** The surface both REST API builders share that these tests drive. */
interface PolicyBuilder {
  policy(policy: Resolvable<PolicyDocument>): PolicyBuilder;
  build(scope: IConstruct, id: string, context?: Record<string, object>): object;
}

const seeded: Record<string, () => PolicyBuilder> = {
  RestApiBuilder: () => createRestApiBuilder().addMethod("GET", new MockIntegration()),
  SpecRestApiBuilder: () =>
    createSpecRestApiBuilder().apiDefinition(
      ApiDefinition.fromInline({
        openapi: "3.0.2",
        info: { title: "TestApi", version: "1.0" },
        paths: {},
      }),
    ),
};

/** The resource policy rendered on the synthesised `AWS::ApiGateway::RestApi`. */
function policyOf(template: Template): unknown {
  const [api] = Object.values(template.findResources("AWS::ApiGateway::RestApi")) as {
    Properties: { Policy?: unknown };
  }[];
  return api.Properties.Policy;
}

describe.each(Object.entries(seeded))("%s policy", (_, factory) => {
  const buildAndSynth = buildFixture(factory, "TestApi");

  it("renders no policy by default", () => {
    const { template } = buildAndSynth();

    expect(policyOf(template)).toBeUndefined();
  });

  it("renders a concrete policy document", () => {
    const { template } = buildAndSynth((b) => b.policy(denyOutsideVpce(SOURCE_VPCE)));

    template.hasResourceProperties("AWS::ApiGateway::RestApi", DENY_OUTSIDE_VPCE);
  });

  it("resolves a ref to a sibling against the build context", () => {
    const { template } = buildAndSynth(
      (b) => b.policy(ref("endpoint", (r: { vpceId: string }) => denyOutsideVpce(r.vpceId))),
      { context: { endpoint: { vpceId: SOURCE_VPCE } } },
    );

    template.hasResourceProperties("AWS::ApiGateway::RestApi", DENY_OUTSIDE_VPCE);
  });
});
