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

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm               | Metric                            | Default threshold   | Created when                                          |
| ------------------- | --------------------------------- | ------------------- | ----------------------------------------------------- |
| `cpuUtilization`    | CPUUtilization (Average, 1 min)   | > 80% over 5 min    | Always                                                |
| `statusCheckFailed` | StatusCheckFailed (Sum, 1 min)    | > 0 over 2 min      | Always                                                |
| `cpuCreditBalance`  | CPUCreditBalance (Minimum, 5 min) | < 50 over 3 x 5 min | `instanceType` is burstable (T2, T3, T3a, T4g family) |

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

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = server.build(stack, "MyInstance");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
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

- [Ec2Stack](../examples/src/ec2-app.ts) — VPC + EC2 instance with SNS-backed alarm actions.
