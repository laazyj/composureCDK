import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import {
  type CfnVolumeAttachment,
  Instance,
  type IKeyPair,
  type ISecurityGroup,
  type IVpc,
  type InstanceProps,
} from "aws-cdk-lib/aws-ec2";
import { type IRole } from "aws-cdk-lib/aws-iam";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { InstanceAlarmConfig } from "./instance-alarm-config.js";
import { createInstanceAlarms } from "./instance-alarms.js";
import { INSTANCE_DEFAULTS } from "./instance-defaults.js";
import {
  type AttachVolumeOptions,
  type AttachVolumeRef,
  createVolumeAttachments,
  type PendingVolumeAttachment,
} from "./instance-volume-attachments.js";

/**
 * Configuration properties for the EC2 instance builder.
 *
 * Extends the CDK {@link InstanceProps} but lifts the cross-component-wiring
 * props to {@link Resolvable} so they can be supplied as either concrete
 * values or {@link Ref}s to sibling components in a {@link compose}d system:
 *
 * - `vpc` is supplied via the dedicated
 *   {@link IInstanceBuilder.vpc | .vpc()} method.
 * - `role`, `keyPair`, and `securityGroup` are exposed on the builder as
 *   `Resolvable<T>` setters.
 *
 * Other props (`instanceType`, `machineImage`, `userData`, `blockDevices`,
 * etc.) are passed through with their CDK types unchanged because they are
 * almost always constructed inline rather than referenced from another
 * component.
 */
export interface InstanceBuilderProps extends Omit<
  InstanceProps,
  "vpc" | "role" | "keyPair" | "securityGroup"
> {
  /**
   * IAM role assumed by the instance via its instance profile.
   *
   * Accepts a concrete {@link IRole} or a {@link Ref} that resolves to one
   * at build time, e.g. a sibling `RoleBuilder` in the same composed system.
   *
   * @default - CDK creates a role and attaches `AmazonSSMManagedInstanceCore`,
   *   driven by the `ssmSessionPermissions: true` default in
   *   {@link INSTANCE_DEFAULTS}.
   */
  role?: Resolvable<IRole>;

  /**
   * Key pair to associate with the instance.
   *
   * Accepts a concrete {@link IKeyPair} or a {@link Ref} that resolves to
   * one at build time.
   *
   * @default - no key pair is associated; SSM Session Manager is the
   *   recommended access path.
   */
  keyPair?: Resolvable<IKeyPair>;

  /**
   * Primary security group for the instance.
   *
   * Accepts a concrete {@link ISecurityGroup} or a {@link Ref} that resolves
   * to one at build time. Additional security groups can be attached via
   * `instance.addSecurityGroup()` after build.
   *
   * @default - CDK creates a security group allowing all outbound traffic.
   */
  securityGroup?: Resolvable<ISecurityGroup>;

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for every applicable metric. Individual alarms can be
   * customized or disabled. Set to `false` to disable the recommended
   * alarms; custom alarms added via `addAlarm()` are still created.
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
   * Includes AWS-recommended instance alarms, any custom alarms added
   * via {@link IInstanceBuilder.addAlarm}, and per-attachment alarms
   * added by {@link IInstanceBuilder.attachVolume} (keyed
   * `${attachmentKey}.${alarmKey}`, e.g. `AgentData.volumeStalledIo`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
   */
  alarms: Record<string, Alarm>;

  /**
   * `AWS::EC2::VolumeAttachment` constructs created via
   * {@link IInstanceBuilder.attachVolume}, keyed by the attachment key
   * supplied in that call.
   *
   * Empty when no volumes were attached.
   */
  volumeAttachments: Record<string, CfnVolumeAttachment>;
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
 * (e.g., to a sibling {@link IVpcBuilder}). The `role`, `keyPair`, and
 * `securityGroup` setters likewise accept {@link Resolvable} values so they
 * can be supplied by sibling builders' outputs via {@link ref}.
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
export type IInstanceBuilder = ITaggedBuilder<InstanceBuilderProps, InstanceBuilder>;

class InstanceBuilder implements Lifecycle<InstanceBuilderResult> {
  props: Partial<InstanceBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<Instance>[] = [];
  readonly #volumeAttachments: PendingVolumeAttachment[] = [];
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

  /**
   * Attaches an externally-managed EBS volume to the instance via an
   * `AWS::EC2::VolumeAttachment` resource, mirroring the call shape of
   * {@link addAlarm}.
   *
   * The `volumeRef` accepts either a `Resolvable<VolumeBuilderResult>`
   * (drop a `ref<VolumeBuilderResult>("data")` straight in) or a
   * `Resolvable<IVolume>` for an externally-managed volume — the builder
   * unwraps either at build time.
   *
   * When both AZs are concrete at synth time, the builder asserts the
   * instance and the volume are in the same Availability Zone — synth-
   * time failure beats boot-time failure for AZ mismatches.
   *
   * Per-attachment AWS-recommended alarms (e.g. `volumeStalledIo`) are
   * created by default and merged into the result's `alarms` record
   * under prefixed keys (`${attachmentKey}.${alarmKey}`).
   *
   * @param key - Unique key for the attachment (used as the result-map
   *   field name and as the construct id suffix).
   * @param volumeRef - Resolvable to the volume to attach.
   * @param options - Attachment options (`device`, `recommendedAlarms`).
   * @returns This builder for chaining.
   */
  attachVolume(key: string, volumeRef: AttachVolumeRef, options: AttachVolumeOptions): this {
    if (this.#volumeAttachments.some((a) => a.key === key)) {
      throw new Error(`attachVolume: duplicate attachment key "${key}".`);
    }
    this.#volumeAttachments.push({ key, volumeRef, options });
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: InstanceBuilder): void {
    target.#vpc = this.#vpc;
    target.#customAlarms.push(...this.#customAlarms);
    target.#volumeAttachments.push(...this.#volumeAttachments);
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): InstanceBuilderResult {
    const resolvedVpc = this.#vpc ? resolve(this.#vpc, context) : undefined;

    if (!resolvedVpc) {
      throw new Error(
        `InstanceBuilder "${id}" requires a VPC. Call .vpc() with an IVpc or a Ref to one.`,
      );
    }

    const {
      recommendedAlarms: alarmConfig,
      role,
      keyPair,
      securityGroup,
      ...instanceProps
    } = this.props;

    const mergedProps = {
      ...INSTANCE_DEFAULTS,
      ...instanceProps,
      vpc: resolvedVpc,
      ...(role !== undefined ? { role: resolve(role, context) } : {}),
      ...(keyPair !== undefined ? { keyPair: resolve(keyPair, context) } : {}),
      ...(securityGroup !== undefined ? { securityGroup: resolve(securityGroup, context) } : {}),
    } as InstanceProps;

    const instance = new Instance(scope, id, mergedProps);

    const instanceAlarms = createInstanceAlarms(
      scope,
      id,
      instance,
      alarmConfig,
      mergedProps,
      this.#customAlarms,
    );

    const { attachments, alarms: attachmentAlarms } = createVolumeAttachments(
      scope,
      id,
      instance,
      mergedProps,
      this.#volumeAttachments,
      context,
    );

    return {
      instance,
      alarms: { ...instanceAlarms, ...attachmentAlarms },
      volumeAttachments: attachments,
    };
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
  return taggedBuilder<InstanceBuilderProps, InstanceBuilder>(InstanceBuilder);
}
