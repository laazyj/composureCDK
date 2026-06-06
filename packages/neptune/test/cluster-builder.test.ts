import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  ClusterParameterGroup,
  EngineVersion,
  InstanceType,
  ParameterGroupFamily,
} from "@aws-cdk/aws-neptune-alpha";
import { ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createClusterBuilder, type IClusterBuilder } from "../src/cluster-builder.js";
import { clusterParameterGroupFamily } from "../src/cluster-parameter-group-defaults.js";

/** Builds a VPC with isolated subnets — Neptune is VPC-only and needs no egress. */
function isolatedVpc(stack: Stack): Vpc {
  return new Vpc(stack, "Vpc", {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
}

function buildCluster(configure?: (b: IClusterBuilder) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const vpc = isolatedVpc(stack);
  const builder = createClusterBuilder()
    .vpc(vpc)
    .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
    .instanceType(InstanceType.R6G_LARGE);
  configure?.(builder);
  const result = builder.build(stack, "Graph");
  return { app, stack, vpc, result, template: Template.fromStack(stack) };
}

describe("ClusterBuilder", () => {
  describe("build", () => {
    it("returns a result exposing every construct it creates", () => {
      const { result } = buildCluster();

      expect(result.cluster).toBeDefined();
      expect(result.subnetGroup).toBeDefined();
      expect(result.clusterParameterGroup).toBeDefined();
      expect(result.alarms).toBeDefined();
    });

    it("creates exactly one Neptune cluster", () => {
      const { template } = buildCluster();

      template.resourceCountIs("AWS::Neptune::DBCluster", 1);
    });

    it("applies well-architected defaults", () => {
      const { template } = buildCluster();

      template.hasResourceProperties("AWS::Neptune::DBCluster", {
        StorageEncrypted: true,
        IamAuthEnabled: true,
        DeletionProtection: true,
        BackupRetentionPeriod: 7,
        CopyTagsToSnapshot: true,
        EnableCloudwatchLogsExports: ["audit"],
      });
    });

    it("retains the cluster on deletion by default", () => {
      const { template } = buildCluster();

      template.hasResource("AWS::Neptune::DBCluster", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });

    it("lets the user override a default", () => {
      const { template } = buildCluster((b) => b.backupRetention(Duration.days(30)));

      template.hasResourceProperties("AWS::Neptune::DBCluster", {
        BackupRetentionPeriod: 30,
      });
    });

    it("throws when no VPC is supplied", () => {
      const stack = new Stack(new App(), "S");
      const builder = createClusterBuilder().instanceType(InstanceType.R6G_LARGE);

      expect(() => builder.build(stack, "Graph")).toThrow(/requires a VPC/);
    });

    it("throws when no instance type is supplied", () => {
      const stack = new Stack(new App(), "S");
      const vpc = isolatedVpc(stack);
      const builder = createClusterBuilder().vpc(vpc);

      expect(() => builder.build(stack, "Graph")).toThrow(/requires an instance type/);
    });
  });

  describe("cluster parameter group", () => {
    it("auto-creates an audit-log-enabled cluster parameter group", () => {
      const { template } = buildCluster();

      template.hasResourceProperties("AWS::Neptune::DBClusterParameterGroup", {
        Parameters: { neptune_enable_audit_log: "1" },
      });
    });

    it("merges user parameters onto the audit-log default", () => {
      const { template } = buildCluster((b) =>
        b.clusterParameters({ neptune_query_timeout: "120000" }),
      );

      template.hasResourceProperties("AWS::Neptune::DBClusterParameterGroup", {
        Parameters: {
          neptune_enable_audit_log: "1",
          neptune_query_timeout: "120000",
        },
      });
    });

    it("uses a user-supplied parameter group and creates no auto group", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = isolatedVpc(stack);
      const group = new ClusterParameterGroup(stack, "MyGroup", {
        family: ParameterGroupFamily.NEPTUNE_1_4,
        parameters: { neptune_enable_audit_log: "0" },
      });
      createClusterBuilder()
        .vpc(vpc)
        .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
        .instanceType(InstanceType.R6G_LARGE)
        .clusterParameterGroup(group)
        .build(stack, "Graph");

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Neptune::DBClusterParameterGroup", 1);
      template.hasResourceProperties("AWS::Neptune::DBClusterParameterGroup", {
        Parameters: { neptune_enable_audit_log: "0" },
      });
    });

    it("throws when clusterParameters is combined with a user-managed group", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = isolatedVpc(stack);
      const group = new ClusterParameterGroup(stack, "MyGroup", {
        family: ParameterGroupFamily.NEPTUNE_1_4,
        parameters: {},
      });
      const builder = createClusterBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.R6G_LARGE)
        .clusterParameterGroup(group)
        .clusterParameters({ neptune_query_timeout: "1" });

      expect(() => builder.build(stack, "Graph")).toThrow(/cannot be combined/);
    });

    it("derives the parameter group family from the configured engine version", () => {
      expect(clusterParameterGroupFamily(EngineVersion.V1_2_0_0)).toBe(
        ParameterGroupFamily.NEPTUNE_1_2,
      );
      expect(clusterParameterGroupFamily(EngineVersion.V1_3_0_0)).toBe(
        ParameterGroupFamily.NEPTUNE_1_3,
      );
      expect(clusterParameterGroupFamily(EngineVersion.V1_4_0_0)).toBe(
        ParameterGroupFamily.NEPTUNE_1_4,
      );
      // Unpinned engine -> current 1.4.x family.
      expect(clusterParameterGroupFamily()).toBe(ParameterGroupFamily.NEPTUNE_1_4);
    });
  });

  describe("recommended alarms", () => {
    it("creates the provisioned alarm set by default (no serverless capacity alarm)", () => {
      const { result } = buildCluster();

      expect(Object.keys(result.alarms).sort()).toEqual([
        "bufferCacheHitRatio",
        "clusterReplicaLag",
        "cpuUtilization",
        "mainRequestQueuePendingRequests",
      ]);
    });

    it("adds the serverless capacity alarm at 90% of maxCapacity for a serverless cluster", () => {
      const { result, template } = buildCluster((b) =>
        b
          .instanceType(InstanceType.SERVERLESS)
          .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 8 }),
      );

      expect(result.alarms.serverlessDatabaseCapacity).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ServerlessDatabaseCapacity",
        Threshold: 7.2,
      });
    });

    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildCluster((b) => b.recommendedAlarms(false));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("lets a single alarm be tuned and another disabled", () => {
      const { result, template } = buildCluster((b) =>
        b.recommendedAlarms({ cpuUtilization: { threshold: 90 }, bufferCacheHitRatio: false }),
      );

      expect(result.alarms.bufferCacheHitRatio).toBeUndefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        Threshold: 90,
      });
    });

    it("supports custom alarms via addAlarm", () => {
      const { result } = buildCluster((b) =>
        b.addAlarm("gremlinErrors", (a) =>
          a
            .metric((cluster) => cluster.metric("NumGremlinErrorsPerSec"))
            .threshold(0)
            .greaterThan(),
        ),
      );

      expect(result.alarms.gremlinErrors).toBeDefined();
    });
  });

  describe("allowAccessFrom", () => {
    it("opens the cluster port to the peer and grants IAM connect", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = isolatedVpc(stack);
      const peerSg = new SecurityGroup(stack, "PeerSg", { vpc });
      const peerRole = new Role(stack, "PeerRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      });
      // A minimal IConnectable & IGrantable peer.
      const peer = { connections: peerSg.connections, grantPrincipal: peerRole.grantPrincipal };

      createClusterBuilder()
        .vpc(vpc)
        .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
        .instanceType(InstanceType.R6G_LARGE)
        .allowAccessFrom(peer)
        .build(stack, "Graph");

      const template = Template.fromStack(stack);
      // Ingress on the cluster's port sourced from the peer SG. The port is a
      // CloudFormation token (the cluster's Port attribute), so match on the
      // protocol and the peer-SG source rather than a literal port number.
      template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        IpProtocol: "tcp",
        SourceSecurityGroupId: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["GroupId"]) }),
      });
      // IAM connect grant on the peer role (the alpha L2 grants the neptune-db
      // data-plane action namespace).
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: Match.stringLikeRegexp("^neptune-db:") }),
          ]),
        }),
      });
    });
  });

  describe("compose / Ref wiring", () => {
    it("resolves a Ref-supplied security group at build time", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = isolatedVpc(stack);
      const sg = new SecurityGroup(stack, "ClusterSg", { vpc });

      createClusterBuilder()
        .vpc(vpc)
        .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
        .instanceType(InstanceType.R6G_LARGE)
        .securityGroups([ref<{ sg: SecurityGroup }>("net").map((r) => r.sg)])
        .build(stack, "Graph", { net: { sg } });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Neptune::DBCluster", {
        VpcSecurityGroupIds: Match.arrayWith([
          { "Fn::GetAtt": [stack.getLogicalId(sg.node.defaultChild as never), "GroupId"] },
        ]),
      });
    });
  });

  describe("copy", () => {
    it("preserves custom alarms (and other non-props state) through copy", () => {
      const vpcRef = ref<{ vpc: Vpc }>("net").map((r) => r.vpc);

      assertCopyPreservesState({
        factory: () =>
          createClusterBuilder()
            .vpc(vpcRef)
            .vpcSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
            .instanceType(InstanceType.R6G_LARGE),
        configure: (b) =>
          b.addAlarm("first", (a) => a.metric((c) => c.metric("CPUUtilization")).threshold(1)),
        mutate: (b) =>
          b.addAlarm("second", (a) => a.metric((c) => c.metric("CPUUtilization")).threshold(2)),
        build: (b) => {
          const stack = new Stack(new App(), "S");
          const vpc = isolatedVpc(stack);
          return b.build(stack, "Graph", { net: { vpc } });
        },
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
