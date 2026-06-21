import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createLedgerTableApp } from "../src/ledger-table-app.js";

describe("ledger-table-app", () => {
  const { stack } = createLedgerTableApp();
  const template = Template.fromStack(stack);

  it("creates one classic DynamoDB table", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
  });

  it("creates one SNS alert topic and a customer-managed KMS key", () => {
    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::KMS::Key", 1);
    template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true });
  });

  it("provisions capacity, overriding the on-demand default (ADR-0009)", () => {
    // CDK omits BillingMode for PROVISIONED (the CFN default); ProvisionedThroughput
    // is the signal that the on-demand default yielded to the capacity settings.
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: Match.absent(),
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      KeySchema: [
        { AttributeName: "accountId", KeyType: "HASH" },
        { AttributeName: "txnId", KeyType: "RANGE" },
      ],
    });
  });

  it("encrypts with the customer-managed key, overriding the AWS-managed default", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      SSESpecification: Match.objectLike({
        SSEEnabled: true,
        KMSMasterKeyId: Match.anyValue(),
      }),
    });
  });

  it("creates the tuned readThrottleEvents alarm (threshold 1, 2 evaluations)", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ReadThrottleEvents",
      Namespace: "AWS/DynamoDB",
      Threshold: 1,
      EvaluationPeriods: 2,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("routes table alarms to the alert topic via alarmActionsPolicy", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ReadThrottleEvents",
      AlarmActions: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp("alerts") })]),
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
