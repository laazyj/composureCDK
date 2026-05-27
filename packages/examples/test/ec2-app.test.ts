import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createEc2App } from "../src/ec2-app.js";

describe("ec2-app", () => {
  const { stack } = createEc2App();
  const template = Template.fromStack(stack);

  it("creates exactly one VPC", () => {
    template.resourceCountIs("AWS::EC2::VPC", 1);
  });

  it("creates exactly one EC2 instance", () => {
    template.resourceCountIs("AWS::EC2::Instance", 1);
  });

  it("creates the bastion and database security groups", () => {
    // VPC_DEFAULTS sets restrictDefaultSecurityGroup, which adds a
    // CustomResource (not an SG). The two visible SGs are the builder's.
    template.resourceCountIs("AWS::EC2::SecurityGroup", 2);
  });

  it("creates recommended CloudWatch alarms for the instance (cpu, status, attached EBS, credit balance)", () => {
    // T3 micro => cpuUtilization + statusCheckFailed + attachedEbsStatusCheckFailed + cpuCreditBalance
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "CPUUtilization",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "StatusCheckFailed",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "StatusCheckFailed_AttachedEBS",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "CPUCreditBalance",
    });
  });

  it("creates an SNS topic for alarm actions", () => {
    template.hasResourceProperties("AWS::SNS::Topic", {
      DisplayName: "EC2 Alerts",
    });
  });

  it("creates a flow log routed to CloudWatch Logs", () => {
    template.resourceCountIs("AWS::EC2::FlowLog", 1);
    template.hasResourceProperties("AWS::EC2::FlowLog", {
      LogDestinationType: "cloud-watch-logs",
    });
  });

  it("closes egress by default on both builder-created SGs", () => {
    // Neither SG should carry an unrestricted 0.0.0.0/0 ALL-traffic egress
    // rule — that's the CDK-default-egress signature the builder turns off.
    const sgs = Object.values(template.findResources("AWS::EC2::SecurityGroup"));
    for (const sg of sgs) {
      const egress = (sg.Properties as { SecurityGroupEgress?: Record<string, unknown>[] })
        .SecurityGroupEgress;
      const unrestricted = egress?.find(
        (rule) => rule.CidrIp === "0.0.0.0/0" && rule.IpProtocol === "-1",
      );
      expect(unrestricted).toBeUndefined();
    }
  });

  it("opens the bastion to operator SSH on the placeholder CIDR", () => {
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupDescription: "Bastion host - operator SSH entry point",
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          CidrIp: "192.0.2.10/32",
          FromPort: 22,
          ToPort: 22,
          IpProtocol: "tcp",
          Description: "Operator SSH",
        }),
      ]),
    });
  });

  it("emits the bastion→database Postgres ingress as a standalone SG ingress resource", () => {
    // Peer-SG-by-id rules emit as a standalone AWS::EC2::SecurityGroupIngress
    // so the source SG's GroupId can be referenced via Fn::GetAtt. This is
    // the canonical synth signature of well-architected peer-SG wiring.
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      IpProtocol: "tcp",
      FromPort: 5432,
      ToPort: 5432,
      Description: "Bastion to Postgres",
      SourceSecurityGroupId: Match.objectLike({
        "Fn::GetAtt": Match.arrayWith(["GroupId"]),
      }),
    });
  });

  it("emits the database self-ingress rule pointing at the database SG on both sides", () => {
    // Pin the self-ingress to a single SG by capturing the GroupId logical
    // id from the GroupId field and asserting SourceSecurityGroupId matches
    // the same id. Without this, a peer-ingress that happened to share the
    // "Intra-tier replication" description would also satisfy the matcher.
    const ingressResources = template.findResources("AWS::EC2::SecurityGroupIngress", {
      Properties: {
        Description: "Intra-tier replication",
        IpProtocol: "tcp",
        FromPort: 5432,
        ToPort: 5432,
      },
    });
    const entries = Object.values(ingressResources);
    expect(entries).toHaveLength(1);
    const props = entries[0]?.Properties as {
      GroupId: { "Fn::GetAtt": [string, string] };
      SourceSecurityGroupId: { "Fn::GetAtt": [string, string] };
    };
    expect(props.SourceSecurityGroupId["Fn::GetAtt"][0]).toBe(props.GroupId["Fn::GetAtt"][0]);
    expect(props.GroupId["Fn::GetAtt"][1]).toBe("GroupId");
  });

  it("attaches the bastion SG (specifically, not the database SG) to the EC2 instance via the cross-builder Ref", () => {
    // Pin the instance's SG reference to the *bastion* logical id, not just
    // any Fn::GetAtt-by-GroupId. With two SGs in the template, a regression
    // that resolved the wrong Ref ("database" instead of "bastion") would
    // satisfy the loose matcher but break the wiring the test exists to
    // confirm. Capture the bastion's logical id from the standalone ingress
    // rule (whose SourceSecurityGroupId is the bastion), then assert the
    // instance references the same id.
    const bastionIngressEntries = Object.values(
      template.findResources("AWS::EC2::SecurityGroupIngress", {
        Properties: { Description: "Bastion to Postgres" },
      }),
    );
    expect(bastionIngressEntries).toHaveLength(1);
    const bastionLogicalId = (
      bastionIngressEntries[0]?.Properties as {
        SourceSecurityGroupId: { "Fn::GetAtt": [string, string] };
      }
    ).SourceSecurityGroupId["Fn::GetAtt"][0];

    template.hasResourceProperties("AWS::EC2::Instance", {
      SecurityGroupIds: [{ "Fn::GetAtt": [bastionLogicalId, "GroupId"] }],
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
