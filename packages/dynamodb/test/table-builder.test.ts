import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import {
  AttributeType,
  BillingMode,
  type ITable,
  StreamViewType,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createTableBuilder } from "../src/table-builder.js";

const PK = { name: "pk", type: AttributeType.STRING };

function synthTemplate(
  configureFn?: (builder: ReturnType<typeof createTableBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createTableBuilder().partitionKey(PK);
  configureFn?.(builder);
  builder.build(stack, "TestTable");
  return Template.fromStack(stack);
}

describe("TableBuilder", () => {
  describe("build", () => {
    it("returns a TableBuilderResult with a table property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableBuilder().partitionKey(PK).build(stack, "TestTable");

      expect(result).toBeDefined();
      expect(result.table).toBeDefined();
    });

    it("creates exactly one DynamoDB table", () => {
      const template = synthTemplate();

      template.resourceCountIs("AWS::DynamoDB::Table", 1);
    });

    it("exposes the alarms record in the result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableBuilder().partitionKey(PK).build(stack, "TestTable");

      expect(result.alarms).toBeDefined();
      expect(typeof result.alarms).toBe("object");
    });

    it("leaves tableStreamArn undefined when no stream is configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableBuilder().partitionKey(PK).build(stack, "TestTable");

      expect(result.tableStreamArn).toBeUndefined();
    });

    it("exposes tableStreamArn when a stream is configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createTableBuilder()
        .partitionKey(PK)
        .stream(StreamViewType.NEW_AND_OLD_IMAGES)
        .build(stack, "TestTable");

      expect(result.tableStreamArn).toBeDefined();
    });
  });

  describe("secure defaults", () => {
    it("uses on-demand (PAY_PER_REQUEST) billing by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        BillingMode: "PAY_PER_REQUEST",
      });
    });

    it("encrypts at rest with an AWS-managed KMS key by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        SSESpecification: { SSEEnabled: true },
      });
    });

    it("enables point-in-time recovery by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      });
    });

    it("enables deletion protection by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        DeletionProtectionEnabled: true,
      });
    });

    it("allows deletion protection to be disabled via the fluent API", () => {
      const template = synthTemplate((b) => b.deletionProtection(false));

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        DeletionProtectionEnabled: false,
      });
    });
  });

  describe("billingMode yields to provisioned capacity (ADR-0009)", () => {
    it("switches to provisioned billing when read/write capacity is set", () => {
      const template = synthTemplate((b) => b.readCapacity(5).writeCapacity(5));

      // The on-demand default is dropped, so CDK falls back to PROVISIONED.
      // PROVISIONED is the CFN default for BillingMode, so CDK omits the
      // property — the presence of ProvisionedThroughput is the signal.
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        BillingMode: Match.absent(),
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      });
    });

    it("honours an explicit PAY_PER_REQUEST override", () => {
      const template = synthTemplate((b) => b.billingMode(BillingMode.PAY_PER_REQUEST));

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        BillingMode: "PAY_PER_REQUEST",
      });
    });
  });

  describe("encryption yields to a customer-managed key (ADR-0009)", () => {
    it("infers CUSTOMER_MANAGED encryption when an encryptionKey is supplied", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const key = new Key(stack, "Key");

      createTableBuilder().partitionKey(PK).encryptionKey(key).build(stack, "TestTable");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        SSESpecification: { SSEEnabled: true, SSEType: "KMS", KMSMasterKeyId: Match.anyValue() },
      });
    });

    it("allows falling back to the free AWS-owned key", () => {
      const template = synthTemplate((b) => b.encryption(TableEncryption.DEFAULT));

      // The AWS-owned key (CDK's TableEncryption.DEFAULT) synthesises as
      // SSEEnabled: false — DynamoDB still encrypts, just with the free key.
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        SSESpecification: { SSEEnabled: false },
      });
    });
  });

  describe("synthesised output", () => {
    it("creates a table with the specified name and key schema", () => {
      const template = synthTemplate((b) =>
        b.tableName("orders").sortKey({ name: "sk", type: AttributeType.NUMBER }),
      );

      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "orders",
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
      });
    });

    it("forwards the stream view type to the underlying CDK construct", () => {
      const template = synthTemplate((b) => b.stream(StreamViewType.NEW_IMAGE));

      template.hasResourceProperties("AWS::DynamoDB::Table", {
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

      createTableBuilder().partitionKey(PK).grantReadWriteData(grantee).build(stack, "TestTable");

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
          table: createTableBuilder()
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
        factory: () => createTableBuilder().partitionKey(PK),
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
