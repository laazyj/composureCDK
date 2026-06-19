import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  InterfaceVpcEndpointAwsService,
  SecurityGroup,
  SubnetType,
  Vpc,
  type IVpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import {
  createInterfaceEndpointBuilder,
  type InterfaceEndpointBuilderResult,
  type SecurityGroupBuilderResult,
  type VpcBuilderResult,
} from "../src/index.js";
import { createSecurityGroupBuilder } from "../src/security-group-builder.js";
import { createVpcBuilder } from "../src/vpc-builder.js";

function freshScope(): { stack: Stack; vpc: Vpc } {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const vpc = new Vpc(stack, "TestVpc", {
    maxAzs: 1,
    natGateways: 0,
    subnetConfiguration: [
      { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
  return { stack, vpc };
}

describe("InterfaceEndpointBuilder", () => {
  describe("build", () => {
    it("returns an InterfaceEndpointBuilderResult with endpoint and alarms properties", () => {
      const { stack, vpc } = freshScope();
      const result = createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .build(stack, "Endpoint");

      expect(result.endpoint).toBeDefined();
      expect(result.alarms).toBeDefined();
    });

    it("creates exactly one VPC endpoint", () => {
      const { stack, vpc } = freshScope();
      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .build(stack, "Endpoint");

      Template.fromStack(stack).resourceCountIs("AWS::EC2::VPCEndpoint", 1);
    });

    it("creates an Interface-type endpoint", () => {
      const { stack, vpc } = freshScope();
      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .build(stack, "Endpoint");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::VPCEndpoint", {
        VpcEndpointType: "Interface",
      });
    });

    it("throws a clear error when vpc is not provided", () => {
      const { stack } = freshScope();
      const builder = createInterfaceEndpointBuilder().service(InterfaceVpcEndpointAwsService.SSM);

      expect(() => builder.build(stack, "Endpoint")).toThrow(/requires a VPC/);
    });

    it("throws a clear error when service is not provided", () => {
      const { stack, vpc } = freshScope();
      const builder = createInterfaceEndpointBuilder().vpc(vpc);

      expect(() => builder.build(stack, "Endpoint")).toThrow(/requires a service/);
    });
  });

  describe("well-architected defaults", () => {
    it("enables private DNS by default", () => {
      const { stack, vpc } = freshScope();
      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .build(stack, "Endpoint");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::VPCEndpoint", {
        PrivateDnsEnabled: true,
      });
    });

    it("never adds an open 0.0.0.0/0 rule to the managed SG", () => {
      const { stack, vpc } = freshScope();
      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .build(stack, "Endpoint");

      const sgs = Template.fromStack(stack).findResources("AWS::EC2::SecurityGroup");
      const managedSg = Object.values(sgs)[0]?.Properties as {
        SecurityGroupIngress?: { CidrIp?: string; IpProtocol?: string }[];
      };
      const openRule = managedSg.SecurityGroupIngress?.find(
        (r) => r.CidrIp === "0.0.0.0/0" && r.IpProtocol === "-1",
      );
      expect(openRule).toBeUndefined();
    });
  });

  describe("managed mode", () => {
    it("auto-creates a managed SG exposed on result.securityGroup", () => {
      const { stack, vpc } = freshScope();
      const result = createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .build(stack, "Endpoint");

      expect(result.securityGroup).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });

    it("allowDefaultPortFrom adds ingress on the managed SG from the peer", () => {
      const { stack, vpc } = freshScope();
      const peerSg = createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Peer")
        .build(stack, "PeerSg").securityGroup;

      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .allowDefaultPortFrom(peerSg, "SSM from peer")
        .build(stack, "Endpoint");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        SourceSecurityGroupId: Match.objectLike({
          "Fn::GetAtt": Match.arrayWith(["GroupId"]),
        }),
      });
    });

    it("allowDefaultPortFrom adds egress on the peer's SG (bidirectional wiring)", () => {
      // This is the key behaviour introduced in this change: delegating to
      // endpoint.connections.allowDefaultPortFrom() ensures the egress rule
      // is added to the peer's SG so peers with allowAllOutbound:false (the
      // SecurityGroupBuilder default) can actually reach the endpoint.
      const { stack, vpc } = freshScope();
      const peerSg = createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Peer")
        .build(stack, "PeerSg").securityGroup;

      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .allowDefaultPortFrom(peerSg)
        .build(stack, "Endpoint");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroupEgress", {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        DestinationSecurityGroupId: Match.objectLike({
          "Fn::GetAtt": Match.arrayWith(["GroupId"]),
        }),
      });
    });

    it("accepts multiple allowDefaultPortFrom peers", () => {
      const { stack, vpc } = freshScope();
      const peer1 = createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Peer 1")
        .build(stack, "Peer1Sg").securityGroup;
      const peer2 = createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Peer 2")
        .build(stack, "Peer2Sg").securityGroup;

      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .allowDefaultPortFrom(peer1, "from peer 1")
        .allowDefaultPortFrom(peer2, "from peer 2")
        .build(stack, "Endpoint");

      // One ingress rule per peer on the managed SG
      const ingress = Template.fromStack(stack).findResources("AWS::EC2::SecurityGroupIngress");
      const port443Rules = Object.values(ingress).filter(
        (r) => (r.Properties as { FromPort: number }).FromPort === 443,
      );
      expect(port443Rules).toHaveLength(2);
    });
  });

  describe("BYO mode", () => {
    it("omits securityGroup from the result when securityGroups() is provided", () => {
      const { stack, vpc } = freshScope();
      const byoSg = new SecurityGroup(stack, "ByoSg", { vpc, description: "BYO" });

      const result = createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .securityGroups([byoSg])
        .build(stack, "Endpoint");

      expect(result.securityGroup).toBeUndefined();
    });

    it("does not create an additional managed SG in BYO mode", () => {
      const { stack, vpc } = freshScope();
      const byoSg = new SecurityGroup(stack, "ByoSg", { vpc, description: "BYO" });

      createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .securityGroups([byoSg])
        .build(stack, "Endpoint");

      // Only the BYO SG — no auto-created managed SG
      Template.fromStack(stack).resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });
  });

  describe("mutex", () => {
    it("throws when allowDefaultPortFrom is combined with securityGroups", () => {
      const { stack, vpc } = freshScope();
      const byoSg = new SecurityGroup(stack, "ByoSg", { vpc, description: "BYO" });
      const peerSg = new SecurityGroup(stack, "PeerSg", { vpc, description: "Peer" });

      const builder = createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .securityGroups([byoSg])
        .allowDefaultPortFrom(peerSg);

      expect(() => builder.build(stack, "Endpoint")).toThrow(/cannot be combined/);
    });
  });

  describe("alarms", () => {
    it("creates the packetsDropped recommended alarm by default", () => {
      const { stack, vpc } = freshScope();
      const result = createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .build(stack, "Endpoint");

      expect(result.alarms.packetsDropped).toBeDefined();
      Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "PacketsDropped",
      });
    });

    it("suppresses all alarms when recommendedAlarms is false", () => {
      const { stack, vpc } = freshScope();
      const result = createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .recommendedAlarms(false)
        .build(stack, "Endpoint");

      expect(Object.keys(result.alarms)).toHaveLength(0);
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("suppresses an individual alarm when set to false in recommendedAlarms config", () => {
      const { stack, vpc } = freshScope();
      const result = createInterfaceEndpointBuilder()
        .vpc(vpc)
        .service(InterfaceVpcEndpointAwsService.SSM)
        .recommendedAlarms({ packetsDropped: false })
        .build(stack, "Endpoint");

      expect(result.alarms.packetsDropped).toBeUndefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("compose integration", () => {
    it("resolves a ref-based vpc at build time", () => {
      const app = new App();
      const stack = new Stack(app, "ComposedStack");

      const system = compose(
        {
          network: createVpcBuilder()
            .maxAzs(1)
            .natGateways(0)
            .subnetConfiguration([
              { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
            ]),
          endpoint: createInterfaceEndpointBuilder()
            .vpc(ref<VpcBuilderResult>("network").get("vpc"))
            .service(InterfaceVpcEndpointAwsService.SSM),
        },
        { network: [], endpoint: ["network"] },
      );

      const result = system.build(stack, "App");
      expect(result.endpoint.endpoint).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::EC2::VPCEndpoint", 1);
    });
  });

  describe("[COPY_STATE]", () => {
    it("preserves #vpc and #access across .copy() without leaking mutations to the original", () => {
      const peer1Ref = ref<SecurityGroupBuilderResult>("peer1").get("securityGroup");
      const peer2Ref = ref<SecurityGroupBuilderResult>("peer2").get("securityGroup");

      assertCopyPreservesState({
        factory: () =>
          createInterfaceEndpointBuilder()
            .vpc(ref<{ vpc: IVpc }>("network").get("vpc"))
            .service(InterfaceVpcEndpointAwsService.SSM),
        configure: (b) => {
          b.allowDefaultPortFrom(peer1Ref, "from peer 1");
        },
        mutate: (b) => {
          b.allowDefaultPortFrom(peer2Ref, "from peer 2");
        },
        build: (b) => {
          const stack = new Stack(new App(), "S");
          const vpc = new Vpc(stack, "Vpc", {
            maxAzs: 1,
            natGateways: 0,
            subnetConfiguration: [
              { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
            ],
          });
          const peer1 = new SecurityGroup(stack, "Peer1", { vpc, description: "peer 1" });
          const peer2 = new SecurityGroup(stack, "Peer2", { vpc, description: "peer 2" });
          return b.build(stack, "Ep", {
            network: { vpc },
            peer1: { securityGroup: peer1 },
            peer2: { securityGroup: peer2 },
          });
        },
        inspect: (r: InterfaceEndpointBuilderResult) => {
          // Count the port-443 SecurityGroupIngress rules — one per allowDefaultPortFrom peer.
          const template = Template.fromStack(Stack.of(r.endpoint));
          const ingress = template.findResources("AWS::EC2::SecurityGroupIngress");
          return Object.values(ingress).filter(
            (res) => (res.Properties as { FromPort?: number }).FromPort === 443,
          ).length;
        },
      });
    });
  });
});
