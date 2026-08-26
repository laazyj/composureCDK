# @composurecdk/neptune

Amazon Neptune cluster builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for Amazon Neptune clusters with secure, AWS-recommended defaults. It wraps the CDK alpha [`DatabaseCluster`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-neptune-alpha-readme.html) L2 construct — refer to the CDK documentation for the full set of configurable properties.

> **Alpha dependency.** Neptune's CDK L2 lives in `@aws-cdk/aws-neptune-alpha`, which is production-usable but semver-unstable and version-locked to its matching `aws-cdk-lib` release. It is a **peer dependency** of this package — install it (and a matching `aws-cdk-lib`) in your app and pin the version you want.

```sh
npm install @composurecdk/neptune @aws-cdk/aws-neptune-alpha aws-cdk-lib
```

## Cluster Builder

A Neptune cluster owns its writer/reader instances — the CDK L2 creates them from the instance type and instance count — so a single cluster builder covers both serverless and provisioned topologies. There is intentionally no separate instance builder: in-region read replicas are added via the instance count (`.instances(n)`), and cross-region scale-out is a [Neptune Global Database](https://docs.aws.amazon.com/neptune/latest/userguide/neptune-global-database.html) (separate read-only clusters per region, future work), not extra instances on one cluster.

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

### Encryption at rest

`storageEncrypted` is on by default, using the AWS-managed Neptune key. `.kmsKey(...)` selects a customer-managed key instead — for independent rotation, a key policy you control, and CloudTrail visibility of decrypt calls. It accepts a concrete key or a `Resolvable`, so a key built by [`@composurecdk/kms`](../kms/README.md) can be a component of the same system rather than a construct created before `compose`:

```ts
import { compose, ref } from "@composurecdk/core";
import { createKeyBuilder, type KeyBuilderResult } from "@composurecdk/kms";

compose(
  {
    graphKey: createKeyBuilder().description("Encrypts the knowledge-graph cluster at rest."),
    graph: createClusterBuilder()
      .vpc(vpc)
      .instanceType(InstanceType.SERVERLESS)
      .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 8 })
      .kmsKey(ref<KeyBuilderResult>("graphKey").get("key")),
  },
  { graphKey: [], graph: ["graphKey"] },
).build(stack, "Knowledge");
```

Both the key and the encryption setting are fixed at creation: Neptune cannot encrypt an existing unencrypted cluster, nor move to a different key, without restoring from a snapshot. Setting `.storageEncrypted(false)` alongside a key is a contradiction CDK rejects at synth — the builder does not silently reconcile it.

### Audit-log parameter group

Audit log _export_ only emits data once audit logging is _enabled_ in the cluster parameter group. So the builder auto-creates a cluster parameter group with `neptune_enable_audit_log = "1"` (parallel to how `createVpcBuilder` auto-creates a flow-log group), with the family derived from the configured engine version. Add or override parameters with `.clusterParameters({...})`, or supply your own group with `.clusterParameterGroup(myGroup)` (mutually exclusive with `.clusterParameters()`).

## Granting access

Because IAM authentication is on by default, a principal needs two things to reach the cluster: a **network path** (security-group ingress on the cluster's port) and an **IAM grant** on the cluster's data plane. Each is declared where it belongs.

The network rule is written into the cluster's own security group, so it stays on the cluster — `allowDefaultPortFrom(peer)`, the same method name `createInterfaceEndpointBuilder` uses. The IAM grant is declared on the **consumer** — the role that needs it — pointing back at the cluster via a `ref`, the consumer-side shape every grant in the library follows ([ADR-0013](../../docs/adr/0013-consumer-side-grants.md)):

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createInstanceBuilder,
  createSecurityGroupBuilder,
  createVpcBuilder,
  type SecurityGroupBuilderResult,
} from "@composurecdk/ec2";
import { createServiceRoleBuilder } from "@composurecdk/iam";
import {
  clusterGrants,
  createClusterBuilder,
  type ClusterBuilderResult,
} from "@composurecdk/neptune";
import { InstanceType } from "@aws-cdk/aws-neptune-alpha";

const system = compose(
  {
    network: createVpcBuilder().maxAzs(2),
    bastionSg: createSecurityGroupBuilder().vpc(ref("network").get("vpc")),

    graph: createClusterBuilder()
      .vpc(ref("network").get("vpc"))
      .instanceType(InstanceType.SERVERLESS)
      .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 8 })
      // network half: open :8182 to the bastion's security group
      .allowDefaultPortFrom(
        ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup"),
        "Bastion to Neptune",
      ),

    bastionRole: createServiceRoleBuilder("ec2.amazonaws.com")
      // IAM half: declared on the consumer, pointing at the cluster
      .grant(clusterGrants.connect(ref("graph", (r: ClusterBuilderResult) => r.cluster))),

    bastion: createInstanceBuilder()
      .vpc(ref("network").get("vpc"))
      .securityGroup(ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup"))
      .role(ref("bastionRole", (r) => r.role))
      .instanceType(/* ... */)
      .machineImage(/* ... */),
  },
  {
    network: [],
    bastionSg: ["network"],
    graph: ["network", "bastionSg"], // cluster → the SG its ingress rule names
    bastionRole: ["graph"], // consumer → resource; no reverse edge, no cycle
    bastion: ["network", "bastionSg", "bastionRole"],
  },
);
```

Splitting the two halves is what keeps the dependency map truthful: the network rule genuinely needs the peer's security group at build time, while the IAM policy lands on the consumer's principal. Pointing both at the cluster would force the cluster to depend on its own consumer — and cycle whenever that consumer also reads the cluster's endpoint.

`allowDefaultPortFrom(peer)` takes any `IConnectable` — a security group, an EC2 instance, a VPC-attached Lambda function — and applies `cluster.connections.allowDefaultPortFrom(peer, description)`, which opens ingress on the cluster's SG **and** the matching egress on the peer's. Prefer referencing the peer's _security group_ over the peer itself: pointing at a compute component makes the cluster depend on it, which is the reverse edge the consumer-side grant exists to avoid.

| Capability                                      | Grants                                                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clusterGrants.connect(cluster)`                | The cluster's native `grantConnect` — the whole `neptune-db:*` namespace on the cluster                                                                         |
| `clusterGrants.dataAccess(cluster, ...actions)` | The cluster's native `grant` with the named [data-plane actions](https://docs.aws.amazon.com/neptune/latest/userguide/iam-dp-actions.html), for least privilege |

If you disable IAM authentication (`.iamAuthentication(false)`), the network path is the whole grant. The alpha L2 then rejects a data-plane grant at synth rather than emitting an inert policy, so drop the `clusterGrants` call along with IAM auth.

### Migrating from `allowAccessFrom`

`allowAccessFrom(peer)` did both halves in one call and has been replaced (see [ADR-0013](../../docs/adr/0013-consumer-side-grants.md)):

```ts
// Before
graph: createClusterBuilder().allowAccessFrom(ref<InstanceBuilderResult>("bastion").get("instance")),
// { graph: ["network", "bastion"] }

// After
graph: createClusterBuilder().allowDefaultPortFrom(
  ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup"),
),
bastionRole: createServiceRoleBuilder("ec2.amazonaws.com").grant(
  clusterGrants.connect(ref("graph", (r: ClusterBuilderResult) => r.cluster)),
),
// { graph: ["network", "bastionSg"], bastionRole: ["graph"] }
```

The grantee must be a builder that accepts grants — a `createRoleBuilder` role or a `createFunctionBuilder` function. Where the old call granted a construct that owns a role (an EC2 instance), give that construct an explicit role component and put the grant there. The exported `ClusterAccessor` type (`IConnectable & IGrantable`) is gone with it; `allowDefaultPortFrom` takes a plain `IConnectable`.

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
