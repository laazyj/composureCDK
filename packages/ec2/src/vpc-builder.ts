import { FlowLogDestination, Vpc, type VpcProps } from "aws-cdk-lib/aws-ec2";
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

  build(scope: IConstruct, id: string): VpcBuilderResult {
    const { flowLogs: flowLogsConfig, ...vpcProps } = this.props;

    const { flowLogsLogGroup, flowLogProps } = resolveFlowLogs(scope, id, flowLogsConfig);

    const mergedProps = {
      ...VPC_DEFAULTS,
      ...flowLogProps,
      ...vpcProps,
    };

    return {
      vpc: new Vpc(scope, id, mergedProps),
      flowLogsLogGroup,
    };
  }
}

function resolveFlowLogs(
  scope: IConstruct,
  id: string,
  cfg: FlowLogsConfig | undefined,
): { flowLogsLogGroup?: LogGroup; flowLogProps: Pick<VpcProps, "flowLogs"> } {
  if (cfg === false) {
    return { flowLogProps: {} };
  }

  if (cfg?.destination !== undefined) {
    if (cfg.configure !== undefined) {
      throw new Error(
        "flowLogs: 'configure' cannot be combined with 'destination' — " +
          "the destination is user-managed and not built by this builder.",
      );
    }
    return {
      flowLogProps: {
        flowLogs: { [DEFAULT_FLOW_LOG_KEY]: { destination: cfg.destination } },
      },
    };
  }

  let subBuilder = createLogGroupBuilder();
  if (cfg?.configure) {
    subBuilder = cfg.configure(subBuilder);
  }
  const flowLogsLogGroup = subBuilder.build(scope, `${id}FlowLogsLogGroup`).logGroup;

  return {
    flowLogsLogGroup,
    flowLogProps: {
      flowLogs: {
        [DEFAULT_FLOW_LOG_KEY]: {
          destination: FlowLogDestination.toCloudWatchLogs(flowLogsLogGroup),
        },
      },
    },
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
