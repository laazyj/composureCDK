import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createEventStoreApp } from "../src/event-store-app.js";

describe("event-store-app", () => {
  const { stack } = createEventStoreApp();
  const template = Template.fromStack(stack);

  it("creates one TableV2 (GlobalTable)", () => {
    template.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
  });

  it("creates no SNS topic — alarm-action wiring is shown in order-processor", () => {
    template.resourceCountIs("AWS::SNS::Topic", 0);
  });

  it("configures the key schema, GSI, TTL and change stream", () => {
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      KeySchema: [
        { AttributeName: "aggregateId", KeyType: "HASH" },
        { AttributeName: "sequence", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: "by-type",
          KeySchema: [
            { AttributeName: "eventType", KeyType: "HASH" },
            { AttributeName: "occurredAt", KeyType: "RANGE" },
          ],
        }),
      ]),
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
    });
  });

  it("is single-region by default (no extra replicas)", () => {
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: Match.arrayWith([Match.objectLike({})]),
    });
    // One replica entry — the primary region — when no context flag is set.
    const tables = template.findResources("AWS::DynamoDB::GlobalTable");
    const [table] = Object.values(tables);
    const props = table.Properties as { Replicas: { Region: string }[] };
    expect(props.Replicas).toHaveLength(1);
  });

  it("creates one Lambda projector wired to the stream via an event source", () => {
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 256,
      Description: "Event projector — consumes the change stream and builds read models",
    });
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
    // dynamoEventSource defaults: start at the stream tip and report partial
    // batch failures.
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "LATEST",
      FunctionResponseTypes: ["ReportBatchItemFailures"],
    });
  });

  it("adds the stream IteratorAge stall alarm for the projector", () => {
    // The dynamoEventSource helper is recognised as a stream source, so the
    // function builder adds the AWS-recommended IteratorAge alarm — a benefit
    // the raw-CDK escape hatch (event-source kind "unknown") did not get.
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "IteratorAge",
      Namespace: "AWS/Lambda",
      Threshold: 60_000,
      EvaluationPeriods: 3,
    });
  });

  it("creates the tuned writeThrottleEvents alarm (threshold 1, 3 evaluations)", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "WriteThrottleEvents",
      Namespace: "AWS/DynamoDB",
      Threshold: 1,
      EvaluationPeriods: 3,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("creates the recommended readThrottleEvents alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ReadThrottleEvents",
      Namespace: "AWS/DynamoDB",
    });
  });

  it("creates the custom userErrors alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "UserErrors",
      Namespace: "AWS/DynamoDB",
      Threshold: 5,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});

describe("event-store-app with opt-in replicas", () => {
  it("adds replica regions when the ddbReplicaRegions context flag is set", () => {
    const app = new App({ context: { ddbReplicaRegions: "us-west-2" } });
    const { stack } = createEventStoreApp(app);
    const template = Template.fromStack(stack);

    const tables = template.findResources("AWS::DynamoDB::GlobalTable");
    const [table] = Object.values(tables);
    const props = table.Properties as { Replicas: { Region: string }[] };
    const regions = props.Replicas.map((r) => r.Region);
    // The primary region (pinned to us-east-1 in tests) plus the requested replica.
    expect(regions).toContain("us-west-2");
    expect(regions).toHaveLength(2);
  });
});
