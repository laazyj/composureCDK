import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Instance, type IVpc, type InstanceProps } from "aws-cdk-lib/aws-ec2";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { InstanceAlarmConfig } from "./instance-alarm-config.js";
import { createInstanceAlarms } from "./instance-alarms.js";
import { INSTANCE_DEFAULTS } from "./instance-defaults.js";

/**
 * Configuration properties for the EC2 instance builder.
 *
 * Extends the CDK {@link InstanceProps} (minus `vpc`, which is supplied via
 * the dedicated {@link IInstanceBuilder.vpc | .vpc()} method to support
 * {@link Resolvable} cross-component wiring) with builder-specific options.
 */
export interface InstanceBuilderProps extends Omit<InstanceProps, "vpc"> {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for every applicable metric. Individual alarms can be
   * customized or disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification methods
   * are user-specific. Access alarms from the build result or use an
   * `afterBuild` hook to apply actions.
   *
   * Contextual alarms (`cpuCreditBalance`) are only created when the
   * corresponding instance configuration is present — e.g., burstable
   * T-family instance types.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
   */
  recommendedAlarms?: InstanceAlarmConfig | false;
}

/**
 * The build output of a {@link IInstanceBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface InstanceBuilderResult {
  instance: Instance;

  /**
   * CloudWatch alarms created for the instance, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via {@link IInstanceBuilder.addAlarm}. Access individual alarms by
   * key (e.g., `result.alarms.cpuUtilization`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an AWS EC2 instance.
 *
 * Each configuration property from the CDK {@link InstanceProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The `vpc` is set via the dedicated {@link IInstanceBuilder.vpc | .vpc()}
 * method that accepts a {@link Resolvable} value for cross-component wiring
 * (e.g., to a sibling {@link IVpcBuilder}).
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * an EC2 instance with the configured properties and returns an
 * {@link InstanceBuilderResult}.
 *
 * AWS-recommended CloudWatch alarms are created by default. Alarms can be
 * customized or disabled via the `recommendedAlarms` property. Custom
 * alarms can be added via the {@link addAlarm} method.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2-readme.html
 *
 * @example
 * ```ts
 * const server = createInstanceBuilder()
 *   .vpc(vpc)
 *   .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
 *   .machineImage(MachineImage.latestAmazonLinux2023());
 * ```
 */
export type IInstanceBuilder = IBuilder<InstanceBuilderProps, InstanceBuilder>;

class InstanceBuilder implements Lifecycle<InstanceBuilderResult> {
  props: Partial<InstanceBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<Instance>[] = [];
  #vpc?: Resolvable<IVpc>;

  /**
   * Sets the VPC the instance will be launched into.
   *
   * Accepts a concrete {@link IVpc} or a {@link Ref} that resolves to one
   * at build time. This is how cross-component wiring works — e.g., to a
   * sibling {@link IVpcBuilder} in the same composed system.
   *
   * @param vpc - The VPC or a Ref to one.
   * @returns This builder for chaining.
   */
  vpc(vpc: Resolvable<IVpc>): this {
    this.#vpc = vpc;
    return this;
  }

  /**
   * Adds a custom CloudWatch alarm to be created alongside the recommended
   * alarms. The provided callback receives an {@link AlarmDefinitionBuilder}
   * scoped to the built {@link Instance}; configure it fluently and return it.
   *
   * @param key - A unique key for the alarm (used to generate the alarm id).
   * @param configure - Callback that configures the alarm definition.
   * @returns This builder for chaining.
   */
  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<Instance>) => AlarmDefinitionBuilder<Instance>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<Instance>(key)));
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): InstanceBuilderResult {
    const resolvedVpc = this.#vpc ? resolve(this.#vpc, context) : undefined;

    if (!resolvedVpc) {
      throw new Error(
        `InstanceBuilder "${id}" requires a VPC. Call .vpc() with an IVpc or a Ref to one.`,
      );
    }

    const { recommendedAlarms: alarmConfig, ...instanceProps } = this.props;

    const mergedProps = {
      ...INSTANCE_DEFAULTS,
      ...instanceProps,
      vpc: resolvedVpc,
    } as InstanceProps;

    const instance = new Instance(scope, id, mergedProps);

    const alarms = createInstanceAlarms(
      scope,
      id,
      instance,
      alarmConfig,
      mergedProps,
      this.#customAlarms,
    );

    return { instance, alarms };
  }
}

/**
 * Creates a new {@link IInstanceBuilder} for configuring an AWS EC2 instance.
 *
 * This is the entry point for defining an EC2 instance component. The
 * returned builder exposes every {@link InstanceBuilderProps} property as a
 * fluent setter/getter, plus {@link IInstanceBuilder.vpc | .vpc()} for
 * cross-component VPC wiring with Ref support. It implements
 * {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS EC2 instance.
 *
 * @example
 * ```ts
 * const server = createInstanceBuilder()
 *   .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *   .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
 *   .machineImage(MachineImage.latestAmazonLinux2023());
 *
 * // Use standalone:
 * const result = server.build(stack, "MyInstance");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { network: createVpcBuilder(), server },
 *   { network: [], server: ["network"] },
 * );
 * ```
 */
export function createInstanceBuilder(): IInstanceBuilder {
  return Builder<InstanceBuilderProps, InstanceBuilder>(InstanceBuilder);
}
