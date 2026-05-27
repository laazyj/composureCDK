import { App, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import {
  type ISecurityGroup,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import {
  createInstanceBuilder,
  createSecurityGroupBuilder,
  createVpcBuilder,
  type SecurityGroupBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { createTopicBuilder } from "@composurecdk/sns";

/**
 * A VPC + two explicit security groups + an EC2 bastion host + an SNS
 * alert topic, all composed into a single stack.
 *
 * Demonstrates:
 * - {@link createVpcBuilder} with well-architected defaults (2 AZs, flow
 *   logs).
 * - {@link createSecurityGroupBuilder} with its closed-egress default —
 *   every outbound flow must be an explicit `addEgressRule`, the
 *   least-privilege stance recommended by AWS Well-Architected
 *   ([SEC05-BP02](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_network_protection_layered.html)).
 * - Cross-component peer-SG wiring: the database SG ingresses on Postgres
 *   from the bastion SG via `ref<SecurityGroupBuilderResult>("bastion")` —
 *   the relationship is data in the `compose()` graph, not procedural
 *   `afterBuild` glue.
 * - Cross-builder wiring: the `InstanceBuilder` consumes the bastion SG's
 *   output via `.securityGroup(ref<...>)`, so the same Ref machinery that
 *   wires VPC → instance also wires SG → instance.
 * - {@link createInstanceBuilder} with well-architected defaults
 *   (IMDSv2, detailed monitoring, encrypted GP3 root, SSM-managed) and
 *   recommended alarms (CPU, status check, CPU credit balance for the
 *   T-family).
 * - Routing every alarm to the alert topic via `alarmActionsPolicy`.
 *
 * No actual database is provisioned — the database SG demonstrates the
 * canonical peer-SG-by-Ref wiring without the cost of a DB instance.
 *
 * NAT gateways are disabled here to keep deploy/destroy fast and cheap
 * for the example workflow. Because the bastion SG defaults to closed
 * egress, the instance has no outbound network of any kind — bumping
 * `natGateways` alone is not enough to make SSM Session Manager work.
 * For an interactively reachable jump-box, also call `.addEgressRule(...)`
 * on the bastion SG for the destinations the workload needs (the SSM
 * service endpoints, or `Peer.anyIpv4()` if you only need internet
 * egress and accept the wider blast radius).
 */
export function createEc2App(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-Ec2Stack");

  const { alerts } = compose(
    {
      alerts: createTopicBuilder().displayName("EC2 Alerts"),

      network: createVpcBuilder().maxAzs(2).natGateways(0),

      bastion: createSecurityGroupBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        // GroupDescription rejects non-ASCII per the EC2 API
        // (allowed: a-zA-Z0-9 ._-:/()#,@[]+=&;{}!$*); avoid em-dashes here.
        .description("Bastion host - operator SSH entry point")
        // Placeholder operator CIDR (RFC 5737 TEST-NET-1) — replace with your
        // network's egress IP before deploying. Kept narrow rather than
        // `Peer.anyIpv4()` so the least-privilege intent is visible.
        .addIngressRule(Peer.ipv4("192.0.2.10/32"), Port.tcp(22), "Operator SSH"),

      database: createSecurityGroupBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .description("Database tier - Postgres ingress from bastion only")
        .addIngressRule(
          ref<SecurityGroupBuilderResult>("bastion").map(
            (r: SecurityGroupBuilderResult): ISecurityGroup => r.securityGroup,
          ),
          Port.tcp(5432),
          "Bastion to Postgres",
        )
        .addSelfIngress(Port.tcp(5432), "Intra-tier replication"),

      server: createInstanceBuilder()
        .vpc(ref<VpcBuilderResult>("network").map((r: VpcBuilderResult): Vpc => r.vpc))
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .securityGroup(
          ref<SecurityGroupBuilderResult>("bastion").map(
            (r: SecurityGroupBuilderResult): ISecurityGroup => r.securityGroup,
          ),
        ),
    },
    {
      alerts: [],
      network: [],
      bastion: ["network"],
      database: ["network", "bastion"],
      server: ["network", "bastion"],
    },
  ).build(stack, "Ec2App");

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
