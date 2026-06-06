import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createNeptuneGraphApp } from "../src/neptune-graph-app.js";

describe("neptune-graph-app", () => {
  const { stack } = createNeptuneGraphApp();
  const template = Template.fromStack(stack);

  it("creates exactly one Neptune cluster", () => {
    template.resourceCountIs("AWS::Neptune::DBCluster", 1);
  });

  it("applies the security and logging defaults", () => {
    template.hasResourceProperties("AWS::Neptune::DBCluster", {
      StorageEncrypted: true,
      IamAuthEnabled: true,
      EnableCloudwatchLogsExports: ["audit"],
    });
  });

  it("configures the cluster as serverless", () => {
    template.hasResourceProperties("AWS::Neptune::DBCluster", {
      ServerlessScalingConfiguration: { MinCapacity: 1, MaxCapacity: 2.5 },
    });
  });

  it("auto-creates an audit-log-enabled cluster parameter group", () => {
    template.hasResourceProperties("AWS::Neptune::DBClusterParameterGroup", {
      Parameters: { neptune_enable_audit_log: "1" },
    });
  });

  it("overrides the stateful defaults so the CI stack can be torn down", () => {
    template.hasResourceProperties("AWS::Neptune::DBCluster", {
      DeletionProtection: false,
    });
    template.hasResource("AWS::Neptune::DBCluster", {
      DeletionPolicy: "Delete",
    });
  });

  it("wires the bastion access grant: cluster SG ingress + IAM connect", () => {
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      IpProtocol: "tcp",
      SourceSecurityGroupId: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["GroupId"]) }),
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.stringLikeRegexp("^neptune-db:") }),
        ]),
      }),
    });
  });

  it("creates the serverless capacity recommended alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ServerlessDatabaseCapacity",
    });
  });

  it("creates an SNS topic for alarm actions", () => {
    template.hasResourceProperties("AWS::SNS::Topic", {
      DisplayName: "Neptune Alerts",
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
