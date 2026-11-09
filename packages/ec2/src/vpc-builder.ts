import { ArnFormat, CfnResource, Stack } from "aws-cdk-lib";
import {
  type FlowLog,
  FlowLogDestination,
  type FlowLogOptions,
  Vpc,
  type VpcProps,
} from "aws-cdk-lib/aws-ec2";
import { PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { createLogGroupBuilder, type ILogGroupBuilder } from "@composurecdk/logs";
import { VPC_DEFAULTS } from "./vpc-defaults.js";

/**
 * Configures how VPC flow logs are handled. Pass `false` to disable flow
 * logs; pass an object to wire a destination or customize the auto-created
 * LogGroup sub-builder.
 *
 * `configure` cannot be combined with `destination` — a user-managed
 * destination is not built by this builder.
 *
 * For multiple flow logs against the same VPC, omit this config and create
 * additional `FlowLog` constructs directly against the returned `vpc`.
 *
 * @see https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html
 */
export type FlowLogsConfig =
  | false
  | {
      /** A user-managed flow log destination. Cannot be combined with `configure`. */
      destination?: FlowLogDestination;
      /**
       * Customize the auto-created LogGroup sub-builder. Receives a builder
       * pre-seeded with the well-architected log retention/removal defaults
       * from {@link createLogGroupBuilder}.
       *
       * The callback receives the build context, so anything
       * `ILogGroupBuilder` accepts as a `Resolvable` can be a `ref` to a
       * sibling component. Declare that component as a dependency.
       */
      configure?: (b: ILogGroupBuilder) => ILogGroupBuilder;
    };

/**
 * Configuration properties for the VPC builder.
 *
 * Hides the CDK `flowLogs` map field in favor of {@link flowLogs} — a
 * discriminated config that supports an `false` opt-out, a user-managed
 * destination, or a customizable auto-managed LogGroup.
 */
export interface VpcBuilderProps extends Omit<VpcProps, "flowLogs"> {
  /** See {@link FlowLogsConfig}. Defaults to an auto-managed LogGroup-backed flow log. */
  flowLogs?: FlowLogsConfig;
}

/**
 * The build output of a {@link IVpcBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface VpcBuilderResult {
  vpc: Vpc;

  /**
   * The CloudWatch LogGroup created for the auto-managed flow log, or
   * `undefined` when the user supplied their own `destination` or
   * disabled flow logs entirely.
   *
   * @see https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html
   */
  flowLogsLogGroup?: LogGroup;
}

/**
 * A fluent builder for configuring and creating an AWS VPC.
 *
 * Each configuration property from the CDK {@link VpcProps} is exposed as an
 * overloaded method: call with a value to set it (returns the builder for
 * chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a VPC with {@link VPC_DEFAULTS | well-architected defaults} and returns a
 * {@link VpcBuilderResult}.
 *
 * By default the builder auto-creates a CloudWatch-Logs-backed flow log
 * using a managed {@link LogGroup} so every VPC gets baseline network audit
 * logging. Customize via {@link FlowLogsConfig} or disable with
 * `flowLogs(false)`.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html
 *
 * @example
 * ```ts
 * const network = createVpcBuilder().maxAzs(3).natGateways(3);
 * ```
 */
export type IVpcBuilder = ITaggedBuilder<VpcBuilderProps, VpcBuilder>;

const DEFAULT_FLOW_LOG_KEY = "DefaultFlowLog";

class VpcBuilder implements Lifecycle<VpcBuilderResult> {
  props: Partial<VpcBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): VpcBuilderResult {
    const { flowLogs: flowLogsConfig, ...vpcProps } = this.props;

    const { flowLogsLogGroup, flowLogOptions } = resolveFlowLogs(
      scope,
      id,
      flowLogsConfig,
      context,
    );

    // CDK accepts `availabilityZones` or `maxAzs`, but not both. When the user
    // pins AZs explicitly, the default `maxAzs` must yield to their intent;
    // setting both is a genuine conflict and fails fast.
    const userPinnedAzs = vpcProps.availabilityZones !== undefined;
    if (userPinnedAzs && vpcProps.maxAzs !== undefined) {
      throw new Error(
        `VpcBuilder "${id}": .availabilityZones() and .maxAzs() are mutually exclusive — ` +
          `CDK accepts one or the other, not both.`,
      );
    }

    const mergedProps = { ...VPC_DEFAULTS, ...vpcProps };
    if (userPinnedAzs) {
      delete mergedProps.maxAzs;
    }

    const vpc = new Vpc(scope, id, mergedProps);
    // Same construct id the `flowLogs` prop would use, so logical IDs match.
    if (flowLogOptions) {
      const flowLog = vpc.addFlowLog(DEFAULT_FLOW_LOG_KEY, flowLogOptions);
      grantDescribeLogStreamsOnLogGroup(flowLog);
      conditionCdkRoleTrust(flowLog);
    }

    return { vpc, flowLogsLogGroup };
  }
}

/**
 * CDK grants `logs:DescribeLogStreams` only on the Log Stream ARN
 * (`log-group:<name>:*`), which stops granting Log Group actions on
 * April 26, 2027 (#652); add it on the bare Log Group ARN. CDK's role is
 * augmented, not replaced: a new role changes `DeliverLogsPermissionArn` and
 * so replaces the flow log. See the README for the upstream flag.
 */
function grantDescribeLogStreamsOnLogGroup(flowLog: FlowLog): void {
  const { iamRole, logGroup } = flowLog;
  if (!iamRole || !logGroup) {
    return;
  }
  iamRole.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ["logs:DescribeLogStreams"],
      resources: [
        Stack.of(flowLog).formatArn({
          service: "logs",
          resource: "log-group",
          resourceName: logGroup.logGroupName,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
    }),
  );
}

/**
 * CDK's flow-log role trusts `vpc-flow-logs.amazonaws.com` with no
 * confused-deputy conditions (#661). `ServicePrincipal` conditions cannot be
 * added once the role exists, so they are set on the L1 trust statement.
 * Each condition key is its own override, so an upstream fix that adds the
 * same keys is overwritten with the same value and any other keys it adds
 * survive. Only the role CDK creates is touched: a role the user passed to
 * `toCloudWatchLogs` is theirs to condition. Upstream: aws/aws-cdk#39674.
 */
function conditionCdkRoleTrust(flowLog: FlowLog): void {
  const role = flowLog.iamRole;
  if (!Role.isRole(role) || role.node.scope !== flowLog) {
    return;
  }
  // No L1 when synthesis is prevented (`Role.customizeRoles`).
  const cfnRole = role.node.defaultChild;
  if (!CfnResource.isCfnResource(cfnRole)) {
    return;
  }
  // The override targets statement 0. CDK builds the role with its `assumedBy`
  // statement as the only one; if that changes, fail rather than condition
  // the wrong statement or leave a second one open.
  const statements = role.assumeRolePolicy?.statementCount;
  if (statements !== 1) {
    throw new Error(
      `VpcBuilder: expected CDK's flow-log role "${role.node.path}" to have one trust ` +
        `statement, found ${String(statements)}. aws-cdk-lib has changed how it builds ` +
        "this role; see https://github.com/laazyj/composureCDK/issues/661.",
    );
  }
  const stack = Stack.of(flowLog);
  const condition = "AssumeRolePolicyDocument.Statement.0.Condition";
  cfnRole.addPropertyOverride(`${condition}.StringEquals.aws:SourceAccount`, stack.account);
  cfnRole.addPropertyOverride(
    `${condition}.ArnLike.aws:SourceArn`,
    stack.formatArn({ service: "ec2", resource: "vpc-flow-log", resourceName: "*" }),
  );
}

function resolveFlowLogs(
  scope: IConstruct,
  id: string,
  cfg: FlowLogsConfig | undefined,
  context?: Record<string, object>,
): { flowLogsLogGroup?: LogGroup; flowLogOptions?: FlowLogOptions } {
  if (cfg === false) {
    return {};
  }

  if (cfg?.destination !== undefined) {
    if (cfg.configure !== undefined) {
      throw new Error(
        "flowLogs: 'configure' cannot be combined with 'destination' — " +
          "the destination is user-managed and not built by this builder.",
      );
    }
    return { flowLogOptions: { destination: cfg.destination } };
  }

  let subBuilder = createLogGroupBuilder();
  if (cfg?.configure) {
    subBuilder = cfg.configure(subBuilder);
  }
  // Pass the build context down: `ILogGroupBuilder` widens `encryptionKey` to a
  // `Resolvable`, so a `configure` callback may hand it a `ref()` to a sibling
  // KMS key. Without the context that ref resolves against an empty record and
  // throws "component not found".
  const flowLogsLogGroup = subBuilder.build(scope, `${id}FlowLogsLogGroup`, context).logGroup;

  return {
    flowLogsLogGroup,
    flowLogOptions: { destination: FlowLogDestination.toCloudWatchLogs(flowLogsLogGroup) },
  };
}

/**
 * Creates a new {@link IVpcBuilder} for configuring an AWS VPC.
 *
 * This is the entry point for defining a VPC component. The returned builder
 * exposes every {@link VpcBuilderProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS VPC.
 *
 * @example
 * ```ts
 * const network = createVpcBuilder().maxAzs(3).natGateways(3);
 *
 * // Use standalone:
 * const result = network.build(stack, "Network");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { network, server: createInstanceBuilder() },
 *   { network: [], server: ["network"] },
 * );
 * ```
 */
export function createVpcBuilder(): IVpcBuilder {
  return taggedBuilder<VpcBuilderProps, VpcBuilder>(VpcBuilder);
}
