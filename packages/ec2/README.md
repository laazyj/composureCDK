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
