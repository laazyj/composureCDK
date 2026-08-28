import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IConnectable, type ISecurityGroup, type IVpc } from "aws-cdk-lib/aws-ec2";
import {
  ClusterParameterGroup,
  DatabaseCluster,
  type DatabaseClusterProps,
  type IClusterParameterGroup,
  type IDatabaseCluster,
  type ISubnetGroup,
} from "@aws-cdk/aws-neptune-alpha";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { CLUSTER_DEFAULTS } from "./cluster-defaults.js";
import {
  CLUSTER_PARAMETER_GROUP_DEFAULTS,
  clusterParameterGroupFamily,
} from "./cluster-parameter-group-defaults.js";
import type { NeptuneClusterAlarmConfig } from "./cluster-alarm-config.js";
import { createClusterAlarms } from "./cluster-alarms.js";

/**
 * Configuration properties for the Neptune cluster builder.
 *
 * Extends the CDK {@link DatabaseClusterProps} but lifts the
 * cross-component-wiring props to {@link Resolvable} so they can be supplied
 * as either concrete values or {@link Ref}s to sibling components in a
 * {@link compose}d system:
 *
 * - `vpc` is supplied via the dedicated {@link IClusterBuilder.vpc | .vpc()}
 *   method (it is required).
 * - `securityGroups` accepts `Resolvable<ISecurityGroup>` entries.
 * - `kmsKey` accepts a `Resolvable` key.
 *
 * It also adds builder-specific options for the auto-created cluster
 * parameter group and recommended alarms.
 */
export interface ClusterBuilderProps extends Omit<
  DatabaseClusterProps,
  "vpc" | "securityGroups" | "kmsKey"
> {
  /**
   * Security groups to attach to the cluster. Accepts concrete
   * {@link ISecurityGroup}s or {@link Ref}s that resolve to them at build
   * time (e.g. a sibling `SecurityGroupBuilder`).
   *
   * @default - CDK creates a security group for the cluster.
   */
  securityGroups?: readonly Resolvable<ISecurityGroup>[];

  /**
   * The customer-managed KMS key used to encrypt the cluster's storage at
   * rest.
   *
   * Accepts a concrete key or a {@link Resolvable} — typically a {@link Ref}
   * to a composed `@composurecdk/kms` key builder, so the key is a component
   * of the system rather than a construct built outside it.
   *
   * The builder already sets `storageEncrypted: true`, so this selects a
   * customer-managed key in place of the AWS-managed Neptune key rather than
   * turning encryption on. Both the key and the encryption setting are fixed
   * at creation — Neptune cannot encrypt an existing unencrypted cluster, nor
   * rotate to a different key, without a snapshot restore.
   *
   * The inner type is read from CDK's own prop rather than named as `IKey`, so
   * it tracks the `kms.IKey` → `kms.IKeyRef` migration in either direction —
   * see the table in `@composurecdk/kms`'s README.
   *
   * @default - the AWS-managed key for Neptune (`aws/rds`).
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/encrypt.html
   */
  kmsKey?: Resolvable<NonNullable<DatabaseClusterProps["kmsKey"]>>;

  /**
   * Parameters to set on the auto-created cluster parameter group, merged
   * onto (and overriding) {@link CLUSTER_PARAMETER_GROUP_DEFAULTS}. Use this
   * to tune engine behaviour without managing a parameter group yourself.
   *
   * Mutually exclusive with `clusterParameterGroup`: a user-managed group is
   * not built (or mutated) by this builder.
   */
  clusterParameters?: Record<string, string>;

  /**
   * Configuration for recommended CloudWatch alarms.
   *
   * By default the builder creates recommended alarms with sensible
   * thresholds for every applicable metric. Individual alarms can be
   * customized or disabled. Set to `false` to disable the recommended
   * alarms; custom alarms added via `addAlarm()` are still created.
   *
   * No alarm actions are configured by default since notification methods
   * are user-specific. Access alarms from the build result or use an
   * `afterBuild` hook to apply actions.
   */
  recommendedAlarms?: NeptuneClusterAlarmConfig | false;
}

/**
 * The build output of an {@link IClusterBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface ClusterBuilderResult {
  /** The Neptune cluster, including the writer/reader instances it manages. */
  cluster: DatabaseCluster;

  /**
   * The DB subnet group the cluster runs in. CDK auto-creates this from the
   * VPC; it is exposed here so it can be reused or asserted against.
   */
  subnetGroup: ISubnetGroup;

  /**
   * The cluster parameter group — either the one supplied via
   * `.clusterParameterGroup()` or the audit-log-enabled group the builder
   * auto-creates.
   */
  clusterParameterGroup: IClusterParameterGroup;

  /**
   * CloudWatch alarms created for the cluster, keyed by alarm key (e.g.
   * `result.alarms.cpuUtilization`). Includes recommended alarms and any
   * added via {@link IClusterBuilder.addAlarm}. No alarm actions are
   * configured — apply them via the result or an `afterBuild` hook.
   */
  alarms: Record<string, Alarm>;
}

interface AccessSpec {
  readonly peer: Resolvable<IConnectable>;
  readonly description?: string;
}

/**
 * A fluent builder for configuring and creating an Amazon Neptune cluster.
 *
 * Each configuration property from the CDK {@link DatabaseClusterProps} is
 * exposed as an overloaded method: call with a value to set it (returns the
 * builder for chaining), or call with no arguments to read the current value.
 *
 * The `vpc` is set via the dedicated {@link IClusterBuilder.vpc | .vpc()}
 * method, which accepts a {@link Resolvable} for cross-component wiring (e.g.
 * to a sibling `VpcBuilder`). `securityGroups` likewise accept
 * {@link Resolvable} values.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built it creates a
 * cluster with {@link CLUSTER_DEFAULTS | well-architected defaults}, an
 * audit-log-enabled cluster parameter group, recommended CloudWatch alarms,
 * and returns a {@link ClusterBuilderResult}.
 *
 * Both provisioned and serverless clusters are supported — set a provisioned
 * `.instanceType(InstanceType.R6G_LARGE)`, or `.instanceType(InstanceType.SERVERLESS)`
 * with `.serverlessScalingConfiguration({ minCapacity, maxCapacity })`.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-neptune-alpha-readme.html
 *
 * @example
 * ```ts
 * const graph = createClusterBuilder()
 *   .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *   .instanceType(InstanceType.SERVERLESS)
 *   .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 8 });
 * ```
 */
export type IClusterBuilder = ITaggedBuilder<ClusterBuilderProps, ClusterBuilder>;

class ClusterBuilder implements Lifecycle<ClusterBuilderResult> {
  props: Partial<ClusterBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IDatabaseCluster>[] = [];
  readonly #access: AccessSpec[] = [];
  #vpc?: Resolvable<IVpc>;

  /**
   * Sets the VPC the cluster runs in. Required. Accepts a concrete
   * {@link IVpc} or a {@link Ref} that resolves to one at build time — the
   * standard cross-component wiring path (e.g. to a sibling `VpcBuilder`).
   *
   * @param vpc - The VPC or a Ref to one.
   * @returns This builder for chaining.
   */
  vpc(vpc: Resolvable<IVpc>): this {
    this.#vpc = vpc;
    return this;
  }

  /**
   * Opens the cluster's port to `peer` via CDK's
   * `cluster.connections.allowDefaultPortFrom(peer)` — ingress on the
   * cluster's security group from the peer's, and the matching egress back on
   * the peer's.
   *
   * This is the **network** half of reaching the cluster. Because IAM
   * authentication is on by default, the peer's principal also needs the
   * data-plane grant, declared on that principal's own builder:
   * `role.grant(clusterGrants.connect(ref("graph", (r) => r.cluster)))` — the
   * consumer-side shape every grant in the library follows (ADR-0013).
   *
   * Accepts a concrete {@link IConnectable} (a `SecurityGroup`, an `Instance`,
   * a `Function` in a VPC, …) or a {@link Ref} to one, so the rule can be
   * declared inside `compose()` rather than wired up in an `afterBuild` hook.
   *
   * @param peer - The connectable to open the port to, or a Ref to one.
   * @param description - Optional description recorded on the ingress rule.
   * @returns This builder for chaining.
   */
  allowDefaultPortFrom(peer: Resolvable<IConnectable>, description?: string): this {
    this.#access.push({ peer, description });
    return this;
  }

  /**
   * Adds a custom CloudWatch alarm to be created alongside the recommended
   * alarms. The callback receives an {@link AlarmDefinitionBuilder} scoped to
   * the built cluster; configure it fluently and return it.
   *
   * @param key - A unique key for the alarm (used to generate the alarm id).
   * @param configure - Callback that configures the alarm definition.
   * @returns This builder for chaining.
   */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<IDatabaseCluster>,
    ) => AlarmDefinitionBuilder<IDatabaseCluster>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IDatabaseCluster>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ClusterBuilder): void {
    target.#vpc = this.#vpc;
    target.#customAlarms.push(...this.#customAlarms);
    target.#access.push(...this.#access);
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): ClusterBuilderResult {
    const resolvedVpc = this.#vpc ? resolve(this.#vpc, context) : undefined;
    if (!resolvedVpc) {
      throw new Error(
        `ClusterBuilder "${id}" requires a VPC. Call .vpc() with an IVpc or a Ref to one.`,
      );
    }

    const {
      recommendedAlarms: alarmConfig,
      securityGroups: resolvableSgs,
      kmsKey,
      clusterParameters,
      clusterParameterGroup: userParameterGroup,
      ...clusterProps
    } = this.props;

    if (clusterProps.instanceType === undefined) {
      throw new Error(
        `ClusterBuilder "${id}" requires an instance type. Call .instanceType() with a ` +
          `provisioned class (e.g. InstanceType.R6G_LARGE) or InstanceType.SERVERLESS ` +
          `paired with .serverlessScalingConfiguration().`,
      );
    }

    if (userParameterGroup !== undefined && clusterParameters !== undefined) {
      throw new Error(
        `ClusterBuilder "${id}": .clusterParameters() cannot be combined with a ` +
          `user-managed .clusterParameterGroup() — the supplied group is not mutated by ` +
          `this builder. Set the parameters on your own group instead.`,
      );
    }

    const clusterParameterGroup =
      userParameterGroup ??
      new ClusterParameterGroup(scope, `${id}ParameterGroup`, {
        family: clusterParameterGroupFamily(clusterProps.engineVersion),
        parameters: { ...CLUSTER_PARAMETER_GROUP_DEFAULTS, ...clusterParameters },
      });

    const securityGroups = resolvableSgs?.map((sg) => resolve(sg, context));

    const mergedProps = {
      ...CLUSTER_DEFAULTS,
      ...clusterProps,
      vpc: resolvedVpc,
      clusterParameterGroup,
      ...(securityGroups ? { securityGroups } : {}),
      ...(kmsKey !== undefined ? { kmsKey: resolve(kmsKey, context) } : {}),
    } as DatabaseClusterProps;

    const cluster = new DatabaseCluster(scope, id, mergedProps);

    for (const rule of this.#access) {
      cluster.connections.allowDefaultPortFrom(resolve(rule.peer, context), rule.description);
    }

    const alarms = createClusterAlarms(
      scope,
      id,
      cluster,
      alarmConfig,
      mergedProps.serverlessScalingConfiguration,
      this.#customAlarms,
    );

    return { cluster, subnetGroup: cluster.subnetGroup, clusterParameterGroup, alarms };
  }
}

/**
 * Creates a new {@link IClusterBuilder} for configuring an Amazon Neptune
 * cluster.
 *
 * This is the entry point for defining a Neptune component. The returned
 * builder exposes every {@link ClusterBuilderProps} property as a fluent
 * setter/getter, plus {@link IClusterBuilder.vpc | .vpc()} and
 * {@link IClusterBuilder.allowDefaultPortFrom | .allowDefaultPortFrom()} for
 * cross-component wiring with Ref support. It implements {@link Lifecycle}
 * for use with {@link compose}.
 *
 * @returns A fluent builder for an Amazon Neptune cluster.
 *
 * @example
 * ```ts
 * const system = compose(
 *   {
 *     network: createVpcBuilder().maxAzs(2),
 *     graph: createClusterBuilder()
 *       .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *       .instanceType(InstanceType.SERVERLESS)
 *       .serverlessScalingConfiguration({ minCapacity: 1, maxCapacity: 8 }),
 *   },
 *   { network: [], graph: ["network"] },
 * );
 * ```
 */
export function createClusterBuilder(): IClusterBuilder {
  return taggedBuilder<ClusterBuilderProps, ClusterBuilder>(ClusterBuilder);
}
