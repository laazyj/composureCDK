# @composurecdk/neptune

Amazon Neptune cluster builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for Amazon Neptune clusters with secure, AWS-recommended defaults. It wraps the CDK alpha [`DatabaseCluster`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-neptune-alpha-readme.html) L2 construct — refer to the CDK documentation for the full set of configurable properties.

> **Alpha dependency.** Neptune's CDK L2 lives in `@aws-cdk/aws-neptune-alpha`, which is production-usable but semver-unstable and version-locked to its matching `aws-cdk-lib` release. It is a **peer dependency** of this package — install it (and a matching `aws-cdk-lib`) in your app and pin the version you want.

```sh
npm install @composurecdk/neptune @aws-cdk/aws-neptune-alpha aws-cdk-lib
```

## Cluster Builder

A Neptune cluster owns its writer/reader instances (the CDK L2 creates them from the instance type and instance count), so a single cluster builder covers both serverless and provisioned topologies — see [ADR-0010](../../docs/adr/0010-neptune-cluster-builder.md) for why this package ships one builder rather than a separate cluster/instance split.

### Serverless

```ts
import { compose, ref } from "@composurecdk/core";
import { createVpcBuilder, type VpcBuilderResult } from "@composurecdk/ec2";
import { createClusterBuilder } from "@composurecdk/neptune";
import { InstanceType } from "@aws-cdk/aws-neptune-alpha";

const system = compose(
  {
    network: createVpcBuilder().maxAzs(2),
    graph: createClusterBuilder()
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .instanceType(InstanceType.SERVERLESS)
      .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 8 }),
  },
  { network: [], graph: ["network"] },
);
```

### Provisioned

```ts
const graph = createClusterBuilder()
  .vpc(ref<VpcBuilderResult>("network").get("vpc"))
  .instanceType(InstanceType.R6G_LARGE)
  .instances(2); // one writer + one reader
```

The `vpc` is set via the dedicated `.vpc()` method (it is required and accepts a `Ref` for cross-component wiring). `securityGroups` likewise accept `Resolvable` values. Every other [`DatabaseClusterProps`](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_aws-neptune-alpha.DatabaseClusterProps.html) property is available as a fluent setter. The `instanceType` is **required** — defaulting it would create surprise cost.

## Build result

`build()` returns every construct the builder creates, per the [build-results-must-be-complete](../../docs/architecture.md) rule:

```ts
interface ClusterBuilderResult {
  cluster: DatabaseCluster;
  subnetGroup: ISubnetGroup;
  clusterParameterGroup: IClusterParameterGroup;
  alarms: Record<string, Alarm>;
}
```

## Secure Defaults

`createClusterBuilder` applies the following defaults. Each can be overridden via the builder's fluent API. Defaults are anchored to the [AWS Well-Architected Framework — Neptune lens](https://docs.aws.amazon.com/prescriptive-guidance/latest/neptune-well-architected-framework/introduction.html).

| Property                  | Default                   | Rationale                                                             |
| ------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `storageEncrypted`        | `true`                    | Encryption at rest; supply a CMK via `.kmsKey()`.                     |
| `iamAuthentication`       | `true`                    | Removes long-lived static credentials.                                |
| `removalPolicy`           | `RETAIN`                  | Protects graph data from an errant `cdk destroy`.                     |
| `deletionProtection`      | `true`                    | Blocks accidental deletion of the cluster.                            |
| `backupRetention`         | `Duration.days(7)`        | Production-grade window (CDK default is 1 day).                       |
| `cloudwatchLogsExports`   | `[LogType.AUDIT]`         | Exports audit logs (the only CloudWatch-exportable Neptune log type). |
| `cloudwatchLogsRetention` | `RetentionDays.ONE_MONTH` | Bounds log storage cost.                                              |
| `copyTagsToSnapshot`      | `true`                    | Preserves cost-allocation tags on backups.                            |
| `autoMinorVersionUpgrade` | `true`                    | Stays on patched engine versions.                                     |

The defaults are exported as `CLUSTER_DEFAULTS` for visibility and testing.

### Audit-log parameter group

Audit log _export_ only emits data once audit logging is _enabled_ in the cluster parameter group. So the builder auto-creates a cluster parameter group with `neptune_enable_audit_log = "1"` (parallel to how `createVpcBuilder` auto-creates a flow-log group), with the family derived from the configured engine version. Add or override parameters with `.clusterParameters({...})`, or supply your own group with `.clusterParameterGroup(myGroup)` (mutually exclusive with `.clusterParameters()`).

## Granting access — `allowAccessFrom`

Because IAM authentication is on by default, a principal needs both a network path (security-group ingress) and an IAM `connect` grant to reach the cluster. `allowAccessFrom(peer)` does both in one declaration, and accepts a `Ref` so the grant lives inside `compose()` rather than in post-build glue:

```ts
import { createInstanceBuilder, type InstanceBuilderResult } from "@composurecdk/ec2";

const system = compose(
  {
    network: createVpcBuilder().maxAzs(2),
    bastion: createInstanceBuilder().vpc(ref("network").get("vpc")).instanceType(/* ... */),
    graph: createClusterBuilder()
      .vpc(ref("network").get("vpc"))
      .instanceType(InstanceType.SERVERLESS)
      .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 8 })
      .allowAccessFrom(ref<InstanceBuilderResult>("bastion").get("instance")),
  },
  { network: [], bastion: ["network"], graph: ["network", "bastion"] },
);
```

The `peer` is any `IConnectable & IGrantable` (an EC2 instance, a Lambda function, a Fargate task, …). At build time the builder applies `cluster.connections.allowDefaultPortFrom(peer)` and `cluster.grantConnect(peer)`.

## Recommended Alarms

The builder creates recommended CloudWatch alarms by default. Neptune is not yet covered by the [CloudWatch out-of-the-box alarm recommendations](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html), so thresholds follow the [Neptune metrics guidance](https://docs.aws.amazon.com/neptune/latest/userguide/best-practices-general-metrics.html). No alarm actions are configured — access alarms from the build result to add actions.

| Alarm                             | Metric                                       | Default threshold    | Created when             |
| --------------------------------- | -------------------------------------------- | -------------------- | ------------------------ |
| `cpuUtilization`                  | CPUUtilization (Average, 1 min)              | >= 80%               | Always                   |
| `mainRequestQueuePendingRequests` | MainRequestQueuePendingRequests (Avg, 1 min) | > 100                | Always                   |
| `bufferCacheHitRatio`             | BufferCacheHitRatio (Average, 1 min)         | < 99.9%              | Always                   |
| `clusterReplicaLag`               | ClusterReplicaLag (Average, 1 min)           | > 30000 ms           | Always[^lag]             |
| `serverlessDatabaseCapacity`      | ServerlessDatabaseCapacity (Average, 1 min)  | 90% of `maxCapacity` | Serverless clusters only |

[^lag]: Only emits data when the cluster has a read replica. `TreatMissingData` defaults to `notBreaching`, so it stays quiet on a single-instance cluster.

The defaults are exported as `CLUSTER_ALARM_DEFAULTS` for visibility and testing.

### Customizing and disabling alarms

```ts
createClusterBuilder()
  // tune one alarm, disable another
  .recommendedAlarms({ cpuUtilization: { threshold: 90 }, bufferCacheHitRatio: false })
  // add a custom alarm
  .addAlarm("gremlinErrors", (a) =>
    a
      .metric((cluster) => cluster.metric("NumGremlinErrorsPerSec"))
      .threshold(0)
      .greaterThan(),
  );

// disable all recommended alarms
createClusterBuilder().recommendedAlarms(false);
```
