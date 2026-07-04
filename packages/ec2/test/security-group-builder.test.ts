import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Peer, Port, type IVpc, Vpc } from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import {
  createSecurityGroupBuilder,
  type SecurityGroupBuilderResult,
} from "../src/security-group-builder.js";
import { createVpcBuilder, type VpcBuilderResult } from "../src/vpc-builder.js";

function freshScope(): { stack: Stack; vpc: Vpc } {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
  return { stack, vpc };
}

describe("SecurityGroupBuilder", () => {
  describe("build", () => {
    it("returns a SecurityGroupBuilderResult with a securityGroup property", () => {
      const { stack, vpc } = freshScope();
      const result = createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Test SG")
        .build(stack, "Sg");

      expect(result).toBeDefined();
      expect(result.securityGroup).toBeDefined();
    });

    it("creates exactly one security group construct", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder().vpc(vpc).description("Test SG").build(stack, "Sg");

      // VPC test fixture has restrictDefaultSecurityGroup off, so the only
      // SG resource is the one the builder created.
      Template.fromStack(stack).resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });

    it("passes through description", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder().vpc(vpc).description("My API tier").build(stack, "Sg");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        GroupDescription: "My API tier",
      });
    });

    it("throws a clear error when vpc is not provided", () => {
      const { stack } = freshScope();
      const builder = createSecurityGroupBuilder().description("Test SG");

      expect(() => builder.build(stack, "Sg")).toThrow(/requires a VPC/);
    });

    it("throws a clear error when description is missing", () => {
      const { stack, vpc } = freshScope();
      const builder = createSecurityGroupBuilder().vpc(vpc);

      expect(() => builder.build(stack, "Sg")).toThrow(/requires a description/);
    });

    it("throws a clear error when description is an empty string", () => {
      const { stack, vpc } = freshScope();
      const builder = createSecurityGroupBuilder().vpc(vpc).description("");

      expect(() => builder.build(stack, "Sg")).toThrow(/requires a description/);
    });

    it("throws a clear error when description is whitespace only", () => {
      const { stack, vpc } = freshScope();
      const builder = createSecurityGroupBuilder().vpc(vpc).description("   ");

      expect(() => builder.build(stack, "Sg")).toThrow(/requires a description/);
    });

    it("validates and passes through a securityGroupName", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Test SG")
        .securityGroupName("bastion-sg")
        .build(stack, "Sg");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        GroupName: "bastion-sg",
      });
    });
  });

  describe("well-architected defaults", () => {
    it("closes all egress by default (allowAllOutbound: false)", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder().vpc(vpc).description("Test SG").build(stack, "Sg");

      // CDK emits a placeholder 255.255.255.255/32 ICMP type 252 rule when
      // allowAllOutbound is false. The diagnostic invariant is the absence
      // of the unrestricted 0.0.0.0/0 ALL-traffic rule that CDK ships when
      // allowAllOutbound is true.
      const sgs = Template.fromStack(stack).findResources("AWS::EC2::SecurityGroup");
      const props = Object.values(sgs)[0]?.Properties as {
        SecurityGroupEgress?: Record<string, unknown>[];
      };
      const unrestrictedAll = props.SecurityGroupEgress?.find(
        (rule) => rule.CidrIp === "0.0.0.0/0" && rule.IpProtocol === "-1",
      );
      expect(unrestrictedAll).toBeUndefined();
    });

    it("preserves the closed-egress default when allowAllOutbound is set to undefined", () => {
      // Defensive: `.allowAllOutbound(cfg?.allowAllOutbound)` with an
      // undefined config value would otherwise write `undefined` into props
      // and the merge would silently override the secure default.
      const { stack, vpc } = freshScope();
      const builder = createSecurityGroupBuilder().vpc(vpc).description("Test SG");
      (
        builder as unknown as { allowAllOutbound: (v: boolean | undefined) => unknown }
      ).allowAllOutbound(undefined);
      builder.build(stack, "Sg");

      const sgs = Template.fromStack(stack).findResources("AWS::EC2::SecurityGroup");
      const props = Object.values(sgs)[0]?.Properties as {
        SecurityGroupEgress?: Record<string, unknown>[];
      };
      const unrestrictedAll = props.SecurityGroupEgress?.find(
        (rule) => rule.CidrIp === "0.0.0.0/0" && rule.IpProtocol === "-1",
      );
      expect(unrestrictedAll).toBeUndefined();
    });

    it("re-opens egress when allowAllOutbound(true) is set explicitly", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Test SG")
        .allowAllOutbound(true)
        .build(stack, "Sg");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({ CidrIp: "0.0.0.0/0", IpProtocol: "-1" }),
        ]),
      });
    });
  });

  describe("rule accumulators", () => {
    it("adds an ingress rule from a CIDR peer", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Public web")
        .addIngressRule(Peer.anyIpv4(), Port.tcp(443), "Public HTTPS")
        .build(stack, "WebSg");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            FromPort: 443,
            ToPort: 443,
            IpProtocol: "tcp",
            Description: "Public HTTPS",
          }),
        ]),
      });
    });

    it("adds an explicit egress rule", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Service tier")
        .addEgressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS to internet")
        .build(stack, "ServiceSg");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            FromPort: 443,
            ToPort: 443,
            IpProtocol: "tcp",
            Description: "HTTPS to internet",
          }),
        ]),
      });
    });

    it("adds an egress rule with no description", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Service tier")
        .addEgressRule(Peer.anyIpv4(), Port.tcp(443))
        .build(stack, "ServiceSg");

      // No description passed through — CDK falls back to its own
      // auto-generated "from <peer>:<port>" description.
      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            CidrIp: "0.0.0.0/0",
            FromPort: 443,
            ToPort: 443,
            IpProtocol: "tcp",
            Description: "from 0.0.0.0/0:443",
          }),
        ]),
      });
    });

    it("accepts a port range", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Range SG")
        .addIngressRule(Peer.ipv4("10.0.0.0/8"), Port.tcpRange(8000, 8100))
        .build(stack, "Sg");

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            CidrIp: "10.0.0.0/8",
            FromPort: 8000,
            ToPort: 8100,
            IpProtocol: "tcp",
          }),
        ]),
      });
    });

    it("accepts a prefix-list peer", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Prefix list peer")
        .addIngressRule(Peer.prefixList("pl-1234abcd"), Port.tcp(443))
        .build(stack, "Sg");

      // Prefix-list peers emit as a standalone SecurityGroupIngress resource
      // because the rule references an external prefix-list id rather than
      // an inline CIDR.
      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        SourcePrefixListId: "pl-1234abcd",
        FromPort: 443,
        ToPort: 443,
        IpProtocol: "tcp",
      });
    });

    it("wires a self-ingress rule against the SG's own group id", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Intra-cluster traffic")
        .addSelfIngress(Port.allTcp(), "All TCP within cluster")
        .build(stack, "ClusterSg");

      // Self-references emit as a separate SecurityGroupIngress resource so
      // the SG can refer to its own GroupId without a circular dependency.
      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        IpProtocol: "tcp",
        FromPort: 0,
        ToPort: 65535,
        Description: "All TCP within cluster",
        GroupId: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["GroupId"]) }),
        SourceSecurityGroupId: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["GroupId"]) }),
      });
    });

    it("wires a self-ingress rule with no description", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Intra-cluster traffic")
        .addSelfIngress(Port.allTcp())
        .build(stack, "ClusterSg");

      Template.fromStack(stack).resourceCountIs("AWS::EC2::SecurityGroupIngress", 1);
    });

    it("resolves a Ref-based peer SG at build time (the canonical two-SG case)", () => {
      const { stack, vpc } = freshScope();

      // Bastion SG is constructed first and supplied to the database SG via
      // a Ref. The database SG resolves the peer at build time and emits an
      // ingress rule referencing the bastion's GroupId.
      const bastion = createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Bastion")
        .build(stack, "BastionSg");

      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Database")
        .addIngressRule(
          ref<SecurityGroupBuilderResult>("bastion").get("securityGroup"),
          Port.tcp(5432),
          "Bastion to Postgres",
        )
        .build(stack, "DatabaseSg", { bastion });

      // The database SG ingress references the bastion SG's GroupId (not a
      // raw CIDR), which is the well-architected peer-SG-by-identity shape.
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        IpProtocol: "tcp",
        FromPort: 5432,
        ToPort: 5432,
        SourceSecurityGroupId: Match.objectLike({
          "Fn::GetAtt": Match.arrayWith(["GroupId"]),
        }),
      });
    });
  });

  describe("compose integration", () => {
    it("orders SG and VPC builds correctly through compose()", () => {
      const app = new App();
      const stack = new Stack(app, "ComposedStack");

      const system = compose(
        {
          network: createVpcBuilder().maxAzs(2).natGateways(0),
          web: createSecurityGroupBuilder()
            .vpc(ref<VpcBuilderResult>("network").get("vpc"))
            .description("Public web")
            .addIngressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS"),
        },
        { network: [], web: ["network"] },
      );

      const result = system.build(stack, "App");
      expect(result.web.securityGroup).toBeDefined();

      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        GroupDescription: "Public web",
      });
    });
  });

  describe("tag propagation", () => {
    it("applies builder tags to the resulting security group", () => {
      const { stack, vpc } = freshScope();
      createSecurityGroupBuilder()
        .vpc(vpc)
        .description("Tagged SG")
        .tag("Project", "rig")
        .tags({ Owner: "platform" })
        .build(stack, "Sg");

      // CDK sorts tags alphabetically by key. Assert both tags are present
      // by checking each independently — Match.arrayWith requires patterns
      // in array order, which is brittle to the sort.
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        Tags: Match.arrayWith([Match.objectLike({ Key: "Project", Value: "rig" })]),
      });
      template.hasResourceProperties("AWS::EC2::SecurityGroup", {
        Tags: Match.arrayWith([Match.objectLike({ Key: "Owner", Value: "platform" })]),
      });
    });
  });

  describe("[COPY_STATE]", () => {
    it("preserves #vpc, #peerRules, and #selfIngress across .copy()", () => {
      const vpcRef = ref<{ vpc: IVpc }>("infra").get("vpc");

      assertCopyPreservesState({
        factory: () => createSecurityGroupBuilder().vpc(vpcRef).description("Variant SG"),
        configure: (b) => {
          b.addIngressRule(Peer.anyIpv4(), Port.tcp(443), "first");
          b.addSelfIngress(Port.tcp(9000), "first-self");
        },
        mutate: (b) => {
          b.addEgressRule(Peer.anyIpv4(), Port.tcp(80), "second");
          b.addSelfIngress(Port.tcp(9001), "second-self");
        },
        build: (b) => {
          const stack = new Stack(new App(), "S");
          const vpc = new Vpc(stack, "Vpc", { maxAzs: 2, natGateways: 0 });
          return b.build(stack, "Sg", { infra: { vpc } });
        },
        // Inspect every rule-bearing resource so any leak of #peerRules or
        // #selfIngress through .copy() shows up in the snapshot. Pin the
        // SG resource by its logical id prefix so future CDK changes that
        // introduce additional SGs in the same stack do not cause the
        // helper to compare the wrong resource.
        inspect: (r) => {
          const template = Template.fromStack(Stack.of(r.securityGroup));
          const sgEntries = Object.entries(template.findResources("AWS::EC2::SecurityGroup"));
          const builderSg = sgEntries.find(([id]) => id.startsWith("Sg"))?.[1].Properties as {
            SecurityGroupIngress?: { Description?: string }[];
            SecurityGroupEgress?: { Description?: string }[];
          };
          const ingressInline = builderSg.SecurityGroupIngress?.map(
            (rule) => rule.Description ?? "",
          ).sort();
          const egressInline = builderSg.SecurityGroupEgress?.map(
            (rule) => rule.Description ?? "",
          ).sort();
          const standaloneIngress = Object.values(
            template.findResources("AWS::EC2::SecurityGroupIngress"),
          )
            .map((res) => (res.Properties as { Description?: string }).Description ?? "")
            .sort();
          return { ingressInline, egressInline, standaloneIngress };
        },
      });
    });
  });
});
