# ADR 0010: Neptune support is a single cluster builder

- **Status:** Accepted
- **Date:** 2026-06-06

## Context

Issue [#141](https://github.com/laazyj/composureCDK/issues/141) asked what
first-class Amazon Neptune support should look like. The research plan on that
issue proposed a **two-builder split** — a `createClusterBuilder` plus a
separate `createInstanceBuilder` — mirroring the cluster/instance shape of
RDS-style services, and a large alarm/parameter-group surface.

Building against the real `@aws-cdk/aws-neptune-alpha` L2 changed the picture:

1. **The L2 `DatabaseCluster` owns its instances.** It requires an
   `instanceType` and creates the writer (and any readers, via the `instances`
   count) itself. A cluster cannot exist without at least one instance, and the
   created instances are not exposed as separate constructs. A standalone
   `DatabaseInstance` builder is only useful for adding _extra, heterogeneous_
   read replicas after the fact — a secondary need, not the headline one. Both
   the issue's serverless example and the real-world data point in the thread
   used a cluster only.
2. **Only audit logs are CloudWatch-exportable.** The L2's `LogType` enum
   exposes `AUDIT` and nothing else; the plan's `["audit", "slowquery"]`
   default is not expressible. Slow-query logging is a parameter-group concern,
   not a CloudWatch export.
3. **Audit export needs a matching parameter group.** Exporting audit logs only
   emits data once `neptune_enable_audit_log` is set on the cluster parameter
   group, whose `family` must match the engine version or the deploy fails.

## Decision

Ship Neptune as a **single `createClusterBuilder`** in `@composurecdk/neptune`.

- **One builder, both topologies.** Serverless (`InstanceType.SERVERLESS` +
  `serverlessScalingConfiguration`) and provisioned (`InstanceType.R6G_LARGE`,
  `.instances(n)`) are the same builder. `instanceType` is required — the
  builder throws if it is unset rather than defaulting it and creating surprise
  cost. A separate instance builder is deferred until there is a concrete need
  for heterogeneous replicas (issue #141 Q2).
- **Auto audit-log parameter group.** When the caller supplies no
  `clusterParameterGroup`, the builder creates one with
  `neptune_enable_audit_log = "1"`, deriving the `family` from the configured
  engine version (defaulting to the current 1.4 family when unpinned). This
  parallels the auto-created flow-log group in `createVpcBuilder` and keeps the
  `cloudwatchLogsExports: [AUDIT]` default coherent end-to-end. `.clusterParameters({...})`
  merges extra parameters; a user-supplied group disables the auto group (the
  two are mutually exclusive).
- **`allowAccessFrom(peer)` for access.** Because IAM authentication is a
  default, a principal needs both network ingress and an IAM `connect` grant.
  `allowAccessFrom` applies `connections.allowDefaultPortFrom(peer)` and
  `grantConnect(peer)` in one declaration and accepts a `Resolvable`, so the
  grant is data inside `compose()` rather than `afterBuild` glue. This answers
  issue #141 Q3 and adopts the combined-grant shape the real-world commenter
  validated.
- **Recommended alarms on the cluster.** A focused set (CPU, request-queue
  backlog, buffer-cache hit ratio, replica lag, and a serverless-only capacity
  alarm) runs through the shared `@composurecdk/cloudwatch` machinery, matching
  every other builder. Neptune is absent from the CloudWatch recommended-alarms
  table, so thresholds cite the Neptune metrics guidance and Well-Architected
  Neptune lens instead.
- **Alpha dependency as a peer.** `@aws-cdk/aws-neptune-alpha` is a
  `peerDependency` with a permissive range; consumers pin it. Its
  version-locked relationship to `aws-cdk-lib` is recorded as the package's
  `cdk-floors.json` floor (ADR-0008).

## Consequences

- The package is materially smaller than the issue plan while covering the
  headline serverless and provisioned use cases, the audit-logging security
  posture, and declarative access wiring. This trades the RDS-shaped
  cluster/instance symmetry for simplicity that matches the L2's actual shape.
- Adding heterogeneous read replicas later means either a `DatabaseInstance`
  builder or an `.instances(n)` increase; the single-builder decision does not
  preclude a future instance builder, it just declines to ship one
  speculatively.
- Two patterns established here — an auto-created parameter group that changes
  _engine behaviour_ (not just observability), and the combined network + IAM
  `allowAccessFrom` grant — are candidates to generalise if a second
  data-store builder (e.g. RDS Aurora) lands.
