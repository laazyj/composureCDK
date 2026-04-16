import { FlowLogDestination, Vpc, type VpcProps } from "aws-cdk-lib/aws-ec2";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { createLogGroupBuilder } from "@composurecdk/logs";
import { VPC_DEFAULTS } from "./vpc-defaults.js";

/**
 * Configuration properties for the VPC builder.
 *
 * Currently identical to the CDK {@link VpcProps} — the builder adds no
 * additional fields in v1. Flow log behavior is controlled through the
 * standard `flowLogs` property; when absent, the builder auto-creates a
 * single CloudWatch-Logs-backed flow log with a managed log group.
 */
export type VpcBuilderProps = VpcProps;

/**
 * The build output of a {@link IVpcBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface VpcBuilderResult {
  /** The VPC construct created by the builder. */
  vpc: Vpc;

  /**
   * The CloudWatch LogGroup created for the auto-managed flow log, or
   * `undefined` if the user supplied their own `flowLogs` configuration.
   *
   * By default the builder creates a managed LogGroup using
   * {@link createLogGroupBuilder} with well-architected defaults
   * (retention, removal policy) and wires it to a single flow log on
   * the VPC. This provides an audit trail for all VPC network traffic
   * without leaking logs into the account's default (infinite retention)
   * log streams.
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
 * When no `flowLogs` configuration is supplied, the builder auto-creates a
 * CloudWatch-Logs-backed flow log using a managed {@link LogGroup} so every
 * VPC gets baseline network audit logging by default.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html
 *
 * @example
 * ```ts
 * const network = createVpcBuilder().maxAzs(3).natGateways(3);
 * ```
 */
export type IVpcBuilder = IBuilder<VpcBuilderProps, VpcBuilder>;

const DEFAULT_FLOW_LOG_KEY = "DefaultFlowLog";

class VpcBuilder implements Lifecycle<VpcBuilderResult> {
  props: Partial<VpcBuilderProps> = {};

  build(scope: IConstruct, id: string): VpcBuilderResult {
    let flowLogsLogGroup: LogGroup | undefined;
    let flowLogsProps: Pick<VpcProps, "flowLogs"> = {};

    if (!this.props.flowLogs) {
      flowLogsLogGroup = createLogGroupBuilder().build(scope, `${id}FlowLogsLogGroup`).logGroup;
      flowLogsProps = {
        flowLogs: {
          [DEFAULT_FLOW_LOG_KEY]: {
            destination: FlowLogDestination.toCloudWatchLogs(flowLogsLogGroup),
          },
        },
      };
    }

    const mergedProps = {
      ...VPC_DEFAULTS,
      ...flowLogsProps,
      ...this.props,
    } as VpcProps;

    return {
      vpc: new Vpc(scope, id, mergedProps),
      flowLogsLogGroup,
    };
  }
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
  return Builder<VpcBuilderProps, VpcBuilder>(VpcBuilder);
}
