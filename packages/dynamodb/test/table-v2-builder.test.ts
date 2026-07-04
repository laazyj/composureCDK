import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import {
  AttributeType,
  Billing,
  Capacity,
  type ITable,
  StreamViewType,
  TableEncryptionV2,
} from "aws-cdk-lib/aws-dynamodb";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createTableV2Builder } from "../src/table-v2-builder.js";

const PK = { name: "pk", type: AttributeType.STRING };

function synthTemplate(
  configureFn?: (builder: ReturnType<typeof createTableV2Builder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createTableV2Builder().partitionKey(PK);
  configureFn?.(builder);
  builder.build(stack, "TestTable");
  return Template.fromStack(stack);
}

describe("TableV2Builder", () => {
  describe("build", () => {
    it("returns a TableV2BuilderResult with a table property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableV2Builder().partitionKey(PK).build(stack, "TestTable");

      expect(result).toBeDefined();
      expect(result.table).toBeDefined();
    });

    it("creates exactly one DynamoDB GlobalTable resource", () => {
      const template = synthTemplate();

      // TableV2 synthesises to AWS::DynamoDB::GlobalTable, not ::Table.
      template.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
      template.resourceCountIs("AWS::DynamoDB::Table", 0);
    });

    it("exposes the alarms record in the result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableV2Builder().partitionKey(PK).build(stack, "TestTable");

      expect(result.alarms).toBeDefined();
      expect(typeof result.alarms).toBe("object");
    });

    it("leaves tableStreamArn undefined when no stream is configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableV2Builder().partitionKey(PK).build(stack, "TestTable");

      expect(result.tableStreamArn).toBeUndefined();
    });

    it("exposes tableStreamArn when a stream is configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableV2Builder()
        .partitionKey(PK)
        .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES)
        .build(stack, "TestTable");

      expect(result.tableStreamArn).toBeDefined();
    });
  });

  describe("secure defaults", () => {
    it("uses on-demand (PAY_PER_REQUEST) billing by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        BillingMode: "PAY_PER_REQUEST",
      });
    });

    it("encrypts at rest with an AWS-managed KMS key by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        SSESpecification: { SSEEnabled: true, SSEType: "KMS" },
      });
    });

    // GlobalTable encodes PITR and deletion protection per-replica (under
    // Replicas[]), not at the resource root like the classic Table — assert
    // against Replicas[0].
    it("enables point-in-time recovery per-replica by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        Replicas: Match.arrayWith([
          Match.objectLike({
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          }),
        ]),
      });
    });

    it("enables deletion protection per-replica by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        Replicas: Match.arrayWith([Match.objectLike({ DeletionProtectionEnabled: true })]),
      });
    });

    it("allows deletion protection to be disabled via the fluent API", () => {
      const template = synthTemplate((b) => b.deletionProtection(false));

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        Replicas: Match.arrayWith([Match.objectLike({ DeletionProtectionEnabled: false })]),
      });
    });
  });

  describe("default overrides", () => {
    it("honours an explicit provisioned billing override", () => {
      const template = synthTemplate((b) =>
        b.billing(
          Billing.provisioned({
            readCapacity: Capacity.fixed(5),
            writeCapacity: Capacity.autoscaled({ maxCapacity: 10 }),
          }),
        ),
      );

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        BillingMode: "PROVISIONED",
      });
    });

    it("uses a customer-managed key when supplied via TableEncryptionV2", () => {
      const app = new App();
      // TableV2 renders per-replica SSE, which CDK refuses to synthesise in a
      // region-agnostic stack — pin an explicit env.
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      const key = new Key(stack, "Key");

      createTableV2Builder()
        .partitionKey(PK)
        .encryption(TableEncryptionV2.customerManagedKey(key))
        .build(stack, "TestTable");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        SSESpecification: { SSEEnabled: true, SSEType: "KMS" },
      });
    });

    it("allows falling back to the free AWS-owned key", () => {
      const template = synthTemplate((b) => b.encryption(TableEncryptionV2.dynamoOwnedKey()));

      // The AWS-owned key (TableEncryptionV2.dynamoOwnedKey) synthesises with
      // SSEEnabled false — DynamoDB still encrypts, just with the free key.
      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        SSESpecification: { SSEEnabled: false },
      });
    });
  });

  describe("synthesised output", () => {
    it("creates a table with the specified name and key schema", () => {
      const template = synthTemplate((b) =>
        b.tableName("orders").sortKey({ name: "sk", type: AttributeType.NUMBER }),
      );

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        TableName: "orders",
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
      });
    });

    it("forwards the stream view type to the underlying CDK construct", () => {
      const template = synthTemplate((b) => b.dynamoStream(StreamViewType.NEW_IMAGE));

      template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
        StreamSpecification: { StreamViewType: "NEW_IMAGE" },
      });
    });
  });

  describe("grants", () => {
    it("grants a concrete principal read/write access, scoped to the table's ARN", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const grantee = new Role(stack, "Grantee", {
        assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      });

      createTableV2Builder().partitionKey(PK).grantReadWriteData(grantee).build(stack, "TestTable");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["dynamodb:GetItem", "dynamodb:PutItem"]),
              Effect: "Allow",
            }),
          ]),
        }),
        Roles: [{ Ref: Match.stringLikeRegexp("^Grantee") }],
      });
    });

    it("resolves a Ref principal from a sibling component before granting", () => {
      const stack = new Stack(new App(), "TestStack");

      const { table } = compose(
        {
          role: {
            build: (scope: Stack, id: string) => ({
              role: new Role(scope, id, { assumedBy: new ServicePrincipal("ec2.amazonaws.com") }),
            }),
          },
          table: createTableV2Builder()
            .partitionKey(PK)
            .grantReadData(ref<{ role: Role }, Role>("role", (r) => r.role)),
        },
        { role: [], table: ["role"] },
      ).build(stack, "System");

      expect(table.table).toBeDefined();
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: Match.arrayWith(["dynamodb:GetItem"]) }),
          ]),
        }),
      });
    });
  });

  describe("copy", () => {
    it("preserves custom alarms across .copy()", () => {
      const userErrors = (table: ITable): Metric =>
        new Metric({
          namespace: "AWS/DynamoDB",
          metricName: "UserErrors",
          dimensionsMap: { TableName: table.tableName },
          statistic: "Sum",
        });

      assertCopyPreservesState({
        factory: () => createTableV2Builder().partitionKey(PK),
        configure: (b) => {
          b.addAlarm("firstCustom", (a) => a.metric(userErrors).threshold(1).greaterThan());
        },
        mutate: (b) => {
          b.addAlarm("secondCustom", (a) => a.metric(userErrors).threshold(5).greaterThan());
        },
        build: (b) => b.build(new Stack(new App(), "S"), "Table"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
