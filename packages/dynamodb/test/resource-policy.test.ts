import { describe, it } from "vitest";
import { Match, type Template } from "aws-cdk-lib/assertions";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { AnyPrincipal, Effect, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { type IConstruct } from "constructs";
import { buildFixture } from "@composurecdk/cdk-testing";
import { ref, type Resolvable } from "@composurecdk/core";
import { createTableBuilder } from "../src/table-builder.js";
import { createTableV2Builder } from "../src/table-v2-builder.js";

const PK = { name: "pk", type: AttributeType.STRING };
const SOURCE_VPCE = "vpce-0123456789abcdef0";

/** A policy denying any caller outside `vpce`. */
function denyOutsideVpce(vpce: string) {
  return new PolicyDocument({
    statements: [
      new PolicyStatement({
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ["dynamodb:*"],
        resources: ["*"],
        conditions: { StringNotEquals: { "aws:SourceVpce": vpce } },
      }),
    ],
  });
}

const DENY_OUTSIDE_VPCE = {
  PolicyDocument: {
    Statement: [
      Match.objectLike({
        Effect: "Deny",
        Principal: { AWS: "*" },
        Action: "dynamodb:*",
        Resource: "*",
        Condition: { StringNotEquals: { "aws:SourceVpce": SOURCE_VPCE } },
      }),
    ],
  },
};

/** The surface both table builders share that these tests drive. */
interface PolicyBuilder {
  resourcePolicy(policy: Resolvable<PolicyDocument>): PolicyBuilder;
  build(scope: IConstruct, id: string, context?: Record<string, object>): object;
}

/** Each builder, and where its resource policy renders: on the table, or on each replica. */
const BUILDERS = {
  TableBuilder: {
    factory: (): PolicyBuilder => createTableBuilder().partitionKey(PK),
    hasPolicy: (template: Template, policy: object) => {
      template.hasResourceProperties("AWS::DynamoDB::Table", { ResourcePolicy: policy });
    },
  },
  TableV2Builder: {
    factory: (): PolicyBuilder => createTableV2Builder().partitionKey(PK),
    hasPolicy: (template: Template, policy: object) => {
      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        Replicas: [Match.objectLike({ ResourcePolicy: policy })],
      });
    },
  },
};

describe.each(Object.entries(BUILDERS))("%s resourcePolicy", (_, { factory, hasPolicy }) => {
  const buildAndSynth = buildFixture(factory, "TestTable");

  it("renders no resource policy by default", () => {
    const { template } = buildAndSynth();

    hasPolicy(template, Match.absent());
  });

  it("renders a concrete policy document", () => {
    const { template } = buildAndSynth((b) => b.resourcePolicy(denyOutsideVpce(SOURCE_VPCE)));

    hasPolicy(template, DENY_OUTSIDE_VPCE);
  });

  it("resolves a ref to a sibling against the build context", () => {
    const { template } = buildAndSynth(
      (b) =>
        b.resourcePolicy(ref("endpoint", (r: { vpceId: string }) => denyOutsideVpce(r.vpceId))),
      { context: { endpoint: { vpceId: SOURCE_VPCE } } },
    );

    hasPolicy(template, DENY_OUTSIDE_VPCE);
  });
});
