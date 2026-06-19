# @composurecdk/ec2

EC2 and VPC builders for [ComposureCDK](../../README.md).

This package provides fluent builders for AWS EC2 instances and VPCs with secure, AWS-recommended defaults. It wraps the CDK [Instance](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Instance.html) and [Vpc](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html) constructs — refer to the CDK documentation for the full set of configurable properties.

## Instance Builder

```ts
import { createInstanceBuilder } from "@composurecdk/ec2";
import { InstanceClass, InstanceSize, InstanceType, MachineImage } from "aws-cdk-lib/aws-ec2";

const server = createInstanceBuilder()
  .vpc(vpc)
  .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
  .machineImage(MachineImage.latestAmazonLinux2023())
  .build(stack, "MyInstance");
```

Every [InstanceProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InstanceProps.html) property is available as a fluent setter on the builder, except `vpc` which is set via the dedicated `.vpc()` method to support cross-component wiring with `ref<T>(...)`.

## Secure Defaults

`createInstanceBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                | Default                                         | Rationale                                                                                                 |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `requireImdsv2`         | `true`                                          | IMDSv2 requires a session token, blocking the SSRF-based credential exfiltration common to IMDSv1.        |
| `detailedMonitoring`    | `true`                                          | 1-minute CloudWatch metric granularity is required for short-window alarm evaluation.                     |
| `ssmSessionPermissions` | `true`                                          | Attaches `AmazonSSMManagedInstanceCore` — Session Manager replaces SSH entirely (no key pairs, bastions). |
| `ebsOptimized`          | `true`                                          | Dedicated EBS bandwidth. Free on current-generation instance types.                                       |
| `blockDevices`          | 8 GiB GP3 root volume at `/dev/xvda`, encrypted | Encrypted at rest with the account's default EBS KMS key.                                                 |

Three properties intentionally have no default — they are application-specific and must be supplied explicitly:

- `vpc` (via the `.vpc()` method)
- `instanceType`
- `machineImage`

The defaults are exported as `INSTANCE_DEFAULTS` for visibility and testing:

```ts
import { INSTANCE_DEFAULTS } from "@composurecdk/ec2";
```

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2) by default. No alarm actions are configured — wire actions via `alarmActionsPolicy` from `@composurecdk/cloudwatch`, or by accessing alarms from the build result.

| Alarm                          | Metric                                         | Default threshold   | Created when                                          |
| ------------------------------ | ---------------------------------------------- | ------------------- | ----------------------------------------------------- |
| `cpuUtilization`               | CPUUtilization (Average, 1 min)                | > 80% over 5 min    | Always                                                |
| `statusCheckFailed`            | StatusCheckFailed (Sum, 1 min)                 | > 0 over 2 min      | Always                                                |
| `attachedEbsStatusCheckFailed` | StatusCheckFailed_AttachedEBS (Maximum, 1 min) | >= 1 over 10 min    | Always                                                |
| `cpuCreditBalance`             | CPUCreditBalance (Minimum, 5 min)              | < 50 over 3 x 5 min | `instanceType` is burstable (T2, T3, T3a, T4g family) |

The defaults are exported as `INSTANCE_ALARM_DEFAULTS` for visibility and testing:

```ts
import { INSTANCE_ALARM_DEFAULTS } from "@composurecdk/ec2";
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const server = createInstanceBuilder()
  .vpc(vpc)
  .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
  .machineImage(MachineImage.latestAmazonLinux2023())
  .recommendedAlarms({
    cpuUtilization: { threshold: 90, evaluationPeriods: 3, datapointsToAlarm: 3 },
  });
```

### Disabling alarms

Disable all recommended alarms:

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

Disable individual alarms:

```ts
builder.recommendedAlarms({ cpuCreditBalance: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to the `Instance`.

```ts
import { Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { Duration } from "aws-cdk-lib";

const server = createInstanceBuilder()
  .vpc(vpc)
  .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
  .machineImage(MachineImage.latestAmazonLinux2023())
  .addAlarm("networkIn", (alarm) =>
    alarm
      .metric(
        (instance) =>
          new Metric({
            namespace: "AWS/EC2",
            metricName: "NetworkIn",
            dimensionsMap: { InstanceId: instance.instanceId },
            statistic: Stats.AVERAGE,
            period: Duration.minutes(1),
          }),
      )
      .threshold(1_000_000_000)
      .greaterThanOrEqual()
      .description("Inbound network traffic is unusually high"),
  );
```

### Attaching persistent volumes

`attachVolume(key, volumeRef, opts)` mirrors the call shape of `addAlarm` and produces an `AWS::EC2::VolumeAttachment` for an externally-managed EBS volume. The volume reference accepts either a `Resolvable<VolumeBuilderResult>` (drop a `ref<VolumeBuilderResult>("data")` straight in) or a `Resolvable<IVolume>`.

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createInstanceBuilder,
  createVolumeBuilder,
  createVpcBuilder,
  type VolumeBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { Size } from "aws-cdk-lib";
import { InstanceClass, InstanceSize, InstanceType, MachineImage } from "aws-cdk-lib/aws-ec2";

compose(
  {
    network: createVpcBuilder().maxAzs(2).natGateways(0),

    data: createVolumeBuilder()
      .availabilityZone(ref<VpcBuilderResult>("network").map((r) => r.vpc.availabilityZones[0]))
      .size(Size.gibibytes(50)),

    agent: createInstanceBuilder()
      .vpc(ref<VpcBuilderResult>("network").map((r) => r.vpc))
      .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
      .machineImage(MachineImage.latestAmazonLinux2023())
      .attachVolume("AgentData", ref<VolumeBuilderResult>("data"), { device: "/dev/sdf" }),
  },
  { network: [], data: ["network"], agent: ["network", "data"] },
).build(stack, "AgentApp");
```

The result exposes the attachment under `result.agent.volumeAttachments.AgentData` and emits a per-attachment `volumeStalledIo` alarm under `result.agent.alarms["AgentData.volumeStalledIo"]`. When both AZs are concrete strings at synth, the builder asserts the instance and volume share an Availability Zone — synth-time failure beats boot-time failure.

`VolumeStalledIOCheck` is published only for Nitro-instance attachments. On non-Nitro instances the alarm sits at `INSUFFICIENT_DATA`, which the `treatMissingData: NOT_BREACHING` default makes harmless. To disable the alarm per attachment:

```ts
.attachVolume("AgentData", ref<VolumeBuilderResult>("data"), {
  device: "/dev/sdf",
  recommendedAlarms: false,
})
```

## VPC Builder

```ts
import { createVpcBuilder } from "@composurecdk/ec2";

const network = createVpcBuilder().maxAzs(3).natGateways(3).build(stack, "Network");
```

Every [VpcProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.VpcProps.html) property is available as a fluent setter on the builder.

### VPC Defaults

| Property                       | Default                           | Rationale                                                                                          |
| ------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `maxAzs`                       | `2`                               | Meaningful HA without overspending. Override to 3+ for stricter production guarantees.             |
| `natGateways`                  | `1`                               | Cost-conscious default. Production HA workloads should set `natGateways` to match `maxAzs`.        |
| `enableDnsSupport`             | `true`                            | Required for most AWS managed services (ALB, RDS, VPC endpoints).                                  |
| `enableDnsHostnames`           | `true`                            | Required for instances to receive public DNS hostnames.                                            |
| `restrictDefaultSecurityGroup` | `true`                            | Strips rules from the default SG, forcing explicit SG design.                                      |
| Flow logs                      | Auto-created CloudWatch log group | Network audit trail with well-architected retention and removal policies via `@composurecdk/logs`. |

The defaults are exported as `VPC_DEFAULTS` for visibility and testing:

```ts
import { VPC_DEFAULTS } from "@composurecdk/ec2";
```

### Flow logs

By default, the builder auto-creates a CloudWatch-Logs-backed flow log with a managed `LogGroup` from `@composurecdk/logs` (two-year retention, `RemovalPolicy.RETAIN`).

Customize the auto-created LogGroup:

```ts
createVpcBuilder().flowLogs({
  configure: (lg) => lg.retention(RetentionDays.NINETY_DAYS).removalPolicy(RemovalPolicy.DESTROY),
});
```

Use a user-managed destination (e.g. an S3 bucket):

```ts
createVpcBuilder().flowLogs({
  destination: FlowLogDestination.toS3(myBucket),
});
```

Disable flow logs entirely:

```ts
createVpcBuilder().flowLogs(false);
```

For multiple flow logs against the same VPC, omit this config and create additional `FlowLog` constructs directly against the returned `vpc`.

## Security Group Builder

```ts
import { createSecurityGroupBuilder } from "@composurecdk/ec2";
import { Peer, Port } from "aws-cdk-lib/aws-ec2";

const web = createSecurityGroupBuilder()
  .vpc(vpc)
  .description("Public web tier")
  .addIngressRule(Peer.anyIpv4(), Port.tcp(443), "Public HTTPS")
  .addEgressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS to origin")
  .build(stack, "WebSg");
```

Every [SecurityGroupProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.SecurityGroupProps.html) property is available as a fluent setter on the builder, except `vpc` which is set via the dedicated `.vpc()` method to support cross-component wiring with `ref<T>(...)`.

Ingress and egress rules are accumulated via `addIngressRule`, `addEgressRule`, and `addSelfIngress` (for the intra-SG "allow within the cluster" pattern). Each peer is a `Resolvable<IPeer>`, so it can be a concrete `IPeer` (a CIDR via `Peer.ipv4(...)`, another `ISecurityGroup`, a prefix list, …) or a `Ref` to a sibling component's output.

### Security Group Defaults

| Property           | Default | Rationale                                                                                                                                                |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowAllOutbound` | `false` | Closes the implicit `0.0.0.0/0` egress rule CDK ships by default. Every outbound flow becomes an explicit `addEgressRule` — the least-privilege default. |

Two properties intentionally have no default — they are application-specific and must be supplied explicitly:

- `vpc` (via the `.vpc()` method)
- `description` (a short, human-readable summary of the SG's purpose; whitespace-only values are rejected)

The defaults are exported as `SECURITY_GROUP_DEFAULTS` for visibility and testing:

```ts
import { SECURITY_GROUP_DEFAULTS } from "@composurecdk/ec2";
```

### Wiring two SGs via `ref`

The canonical cross-component pattern — a bastion SG and a database SG that talks to it — declares the dependency in `compose()` and resolves the peer at build time:

```ts
import { compose, ref } from "@composurecdk/core";
import { createSecurityGroupBuilder, createVpcBuilder } from "@composurecdk/ec2";
import type { SecurityGroupBuilderResult, VpcBuilderResult } from "@composurecdk/ec2";
import { Port } from "aws-cdk-lib/aws-ec2";

compose(
  {
    network: createVpcBuilder(),
    bastion: createSecurityGroupBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .description("Bastion host"),
    database: createSecurityGroupBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .description("Database")
      .addIngressRule(
        ref<SecurityGroupBuilderResult>("bastion").get("securityGroup"),
        Port.tcp(5432),
        "Bastion to Postgres",
      ),
  },
  { network: [], bastion: ["network"], database: ["network", "bastion"] },
).build(stack, "App");
```

### Recommended Alarms

The Security Group builder does **not** create CloudWatch alarms. Security groups do not emit CloudWatch metrics — the [AWS recommended-alarms reference](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html) has no SG entry. Operational visibility for SGs comes from adjacent signals (VPC Flow Logs, GuardDuty findings, CloudTrail `AuthorizeSecurityGroupIngress`/`Egress` events), none of which belong on the builder result.

## Interface Endpoint Builder

VPC interface endpoints (AWS PrivateLink) have no props-time surface in CDK —
the only way to add one is the post-build `vpc.addInterfaceEndpoint(...)` call,
whose security group is never exposed. `createInterfaceEndpointBuilder` makes an
endpoint a first-class `compose()` component. It maps **1:1 to a CDK
`InterfaceVpcEndpoint`** (one `service` per endpoint) and supports two security
group modes:

- **BYO** — `.securityGroups([...])` with SGs you fully manage (typically
  sibling `SecurityGroupBuilder`s): full ingress/egress/port control.
- **Managed shortcut** — omit `.securityGroups()` and the builder auto-creates a
  closed SG, exposes it on the result, and `.allowDefaultPortFrom(peer)` opens
  ingress on the service's default port.

The two are mutually exclusive (combining them throws). To group several
endpoints under one access policy, point them at the same security group.

### Minimalist single service (managed shortcut)

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createInterfaceEndpointBuilder,
  createSecurityGroupBuilder,
  createVpcBuilder,
  type SecurityGroupBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { InterfaceVpcEndpointAwsService, SubnetType } from "aws-cdk-lib/aws-ec2";

compose(
  {
    network: createVpcBuilder().natGateways(0),
    bastionSg: createSecurityGroupBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .description("Bastion"),
    ssm: createInterfaceEndpointBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .service(InterfaceVpcEndpointAwsService.SSM)
      .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
      .allowDefaultPortFrom(ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup")),
  },
  { network: [], bastionSg: ["network"], ssm: ["network", "bastionSg"] },
).build(stack, "App");
// result.ssm = { endpoint: InterfaceVpcEndpoint, securityGroup: SecurityGroup }
```

The managed `securityGroup` is on the result so the **peer's egress side** can
reference it (`bastionSg.addEgressRule(ref("ssm").get("securityGroup"), Port.tcp(443))`).

### SSM access (multiple endpoints, one shared SG)

SSM/Session Manager in a NAT-free VPC needs three endpoints with identical
ingress. One endpoint per builder — share a single BYO `SecurityGroupBuilder`
across all three. The access policy lives on the shared SG, not on individual
endpoints:

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createInterfaceEndpointBuilder,
  createSecurityGroupBuilder,
  createVpcBuilder,
  type SecurityGroupBuilderResult,
  type VpcBuilderResult,
} from "@composurecdk/ec2";
import { InterfaceVpcEndpointAwsService, Port, SubnetType } from "aws-cdk-lib/aws-ec2";

compose(
  {
    network: createVpcBuilder().natGateways(0),
    bastionSg: createSecurityGroupBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .description("Bastion"),
    // One SG shared by all three endpoints — the access policy lives here.
    endpointSg: createSecurityGroupBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .description("SSM endpoints")
      .addIngressRule(
        ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup"),
        Port.tcp(443),
      ),
    ssm: createInterfaceEndpointBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .service(InterfaceVpcEndpointAwsService.SSM)
      .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
      .securityGroups([ref<SecurityGroupBuilderResult>("endpointSg").get("securityGroup")]),
    ssmmessages: createInterfaceEndpointBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .service(InterfaceVpcEndpointAwsService.SSM_MESSAGES)
      .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
      .securityGroups([ref<SecurityGroupBuilderResult>("endpointSg").get("securityGroup")]),
    ec2messages: createInterfaceEndpointBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .service(InterfaceVpcEndpointAwsService.EC2_MESSAGES)
      .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
      .securityGroups([ref<SecurityGroupBuilderResult>("endpointSg").get("securityGroup")]),
  },
  {
    network: [],
    bastionSg: ["network"],
    endpointSg: ["network", "bastionSg"],
    ssm: ["network", "endpointSg"],
    ssmmessages: ["network", "endpointSg"],
    ec2messages: ["network", "endpointSg"],
  },
).build(stack, "App");
```

### Complex / custom service (BYO security group)

A custom PrivateLink service on a non-443 port, with precise ingress _and_
egress controlled by the `SecurityGroupBuilder` you already have:

```ts
import { InterfaceVpcEndpointService, Port } from "aws-cdk-lib/aws-ec2";

compose(
  {
    network: createVpcBuilder(),
    appSg: createSecurityGroupBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .description("App tier"),
    endpointSg: createSecurityGroupBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .description("Partner PrivateLink endpoint")
      .addIngressRule(ref<SecurityGroupBuilderResult>("appSg").get("securityGroup"), Port.tcp(8443))
      .addEgressRule(ref<SecurityGroupBuilderResult>("appSg").get("securityGroup"), Port.tcp(8443)),
    partner: createInterfaceEndpointBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .service(
        new InterfaceVpcEndpointService("com.amazonaws.vpce.eu-west-1.vpce-svc-0abc123", 8443),
      )
      .securityGroups([ref<SecurityGroupBuilderResult>("endpointSg").get("securityGroup")]),
  },
  {
    network: [],
    appSg: ["network"],
    endpointSg: ["network", "appSg"],
    partner: ["network", "endpointSg"],
  },
).build(stack, "App");
// result.partner = { endpoint: InterfaceVpcEndpoint }  (no managed securityGroup in BYO mode)
```

### Interface Endpoint Defaults

`createInterfaceEndpointBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property            | Default | Rationale                                                                                                                                                                                                       |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privateDnsEnabled` | `true`  | Enables `<service>.<region>.amazonaws.com` to resolve to the endpoint ENIs, keeping traffic on the AWS network without requiring application-level changes. Disabled by default in raw CDK for custom services. |

The defaults are exported as `INTERFACE_ENDPOINT_DEFAULTS` for visibility and testing:

```ts
import { INTERFACE_ENDPOINT_DEFAULTS } from "@composurecdk/ec2";
```

### Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#PrivateLinkEndpoints) by default. No alarm actions are configured — wire actions via `alarmActionsPolicy` from `@composurecdk/cloudwatch`, or by accessing alarms from the build result.

| Alarm            | Metric                      | Default threshold            | Created when |
| ---------------- | --------------------------- | ---------------------------- | ------------ |
| `packetsDropped` | PacketsDropped (Sum, 1 min) | > 0 over 5 consecutive 1-min | Always       |

If your workload intentionally sends packets larger than 8,500 bytes (the PrivateLink MTU limit), raise the threshold to reduce noise from expected MTU drops:

```ts
createInterfaceEndpointBuilder()
  .vpc(ref<VpcBuilderResult>("network").get("vpc"))
  .service(InterfaceVpcEndpointAwsService.SSM)
  .recommendedAlarms({ packetsDropped: { threshold: 100 } });
```

Disable all recommended alarms:

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

Disable individual alarms:

```ts
builder.recommendedAlarms({ packetsDropped: false });
```

The defaults are exported as `INTERFACE_ENDPOINT_ALARM_DEFAULTS` for visibility and testing:

```ts
import { INTERFACE_ENDPOINT_ALARM_DEFAULTS } from "@composurecdk/ec2";
```

## Volume Builder

```ts
import { createVolumeBuilder } from "@composurecdk/ec2";
import { Size } from "aws-cdk-lib";

const data = createVolumeBuilder()
  .availabilityZone("us-east-1a")
  .size(Size.gibibytes(50))
  .build(stack, "AgentData");
```

Every [VolumeProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.VolumeProps.html) property is available as a fluent setter on the builder, except `availabilityZone` which is set via the dedicated `.availabilityZone()` method (so it can be wired from a sibling `VpcBuilder` via `ref`) and `encryptionKey` which accepts a `Resolvable<IKey>` for cross-component KMS-key wiring.

### Volume Defaults

| Property        | Default                | Rationale                                                                                                 |
| --------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `volumeType`    | `GP3`                  | Current-generation general-purpose SSD — cheaper and faster than GP2 at equivalent sizes.                 |
| `encrypted`     | `true`                 | Encryption at rest with the account's default EBS KMS key. Pass `encryptionKey` for a CMK.                |
| `autoEnableIo`  | `true`                 | Lets I/O resume on suspected inconsistency so the instance can come up unattended.                        |
| `removalPolicy` | `RemovalPolicy.RETAIN` | A destroyed volume is unrecoverable; an orphaned volume is a $/month nuisance. Mirrors `BUCKET_DEFAULTS`. |

Three properties intentionally have no default — they are application-specific and must be supplied explicitly:

- `availabilityZone` (via the `.availabilityZone()` method)
- `size`
- `iops` / `throughput` (only when opting into a volume type that requires them)

The defaults are exported as `VOLUME_DEFAULTS` for visibility and testing:

```ts
import { VOLUME_DEFAULTS } from "@composurecdk/ec2";
```

### Recommended Volume Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS) by default. No alarm actions are configured — wire actions via `alarmActionsPolicy` from `@composurecdk/cloudwatch`.

| Alarm          | Metric                        | Default threshold    | Created when                                    |
| -------------- | ----------------------------- | -------------------- | ----------------------------------------------- |
| `burstBalance` | BurstBalance (Average, 5 min) | < 20% over 3 × 5 min | `volumeType` is burstable (`gp2`, `st1`, `sc1`) |

The defaults are exported as `VOLUME_ALARM_DEFAULTS` for visibility and testing:

```ts
import { VOLUME_ALARM_DEFAULTS } from "@composurecdk/ec2";
```

`VolumeQueueLength` and `VolumeIdleTime` are deferred — both need per-`volumeType`/per-workload tuning to be a defensible default. Wire them via `addAlarm` until first-class support lands:

```ts
import { Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { Duration } from "aws-cdk-lib";

const data = createVolumeBuilder()
  .availabilityZone("us-east-1a")
  .size(Size.gibibytes(50))
  .addAlarm("volumeQueueLength", (alarm) =>
    alarm
      .metric(
        (volume) =>
          new Metric({
            namespace: "AWS/EBS",
            metricName: "VolumeQueueLength",
            dimensionsMap: { VolumeId: volume.volumeId },
            statistic: Stats.AVERAGE,
            period: Duration.minutes(5),
          }),
      )
      .threshold(10)
      .greaterThan()
      .description("EBS volume queue length is high"),
  );
```

## Composing EC2 + VPC

Compose the builders into a single system — the instance is wired to the VPC via `ref`:

```ts
import { compose, ref } from "@composurecdk/core";
import { createInstanceBuilder, createVpcBuilder, type VpcBuilderResult } from "@composurecdk/ec2";
import type { Vpc } from "aws-cdk-lib/aws-ec2";

compose(
  {
    network: createVpcBuilder(),
    server: createInstanceBuilder()
      .vpc(ref<VpcBuilderResult>("network").map((r): Vpc => r.vpc))
      .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
      .machineImage(MachineImage.latestAmazonLinux2023()),
  },
  { network: [], server: ["network"] },
).build(stack, "Ec2App");
```

## Examples

- [Ec2Stack](../examples/src/ec2-app.ts) — VPC + EC2 instance with alarms wired to an SNS topic via `alarmActionsPolicy`.
