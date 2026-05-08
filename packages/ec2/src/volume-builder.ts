import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Volume, type VolumeProps } from "aws-cdk-lib/aws-ec2";
import { type IKey } from "aws-cdk-lib/aws-kms";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { VolumeAlarmConfig } from "./volume-alarm-config.js";
import { createVolumeAlarms } from "./volume-alarms.js";
import { VOLUME_DEFAULTS } from "./volume-defaults.js";

/**
 * Configuration properties for the EBS volume builder.
 *
 * Extends the CDK {@link VolumeProps} but lifts the cross-component-wiring
 * props to {@link Resolvable} so they can be supplied as either concrete
 * values or {@link Ref}s to sibling components in a {@link compose}d system:
 *
 * - `availabilityZone` is supplied via the dedicated
 *   {@link IVolumeBuilder.availabilityZone | .availabilityZone()} method
 *   so it can be wired from a sibling `VpcBuilder`.
 * - `encryptionKey` is exposed on the builder as a `Resolvable<IKey>`
 *   setter so a sibling KMS key builder can supply a CMK.
 *
 * Other props (`size`, `volumeType`, `iops`, `throughput`, `enableMultiAttach`,
 * `autoEnableIo`, `removalPolicy`, etc.) are passed through with their CDK
 * types unchanged because they are almost always constructed inline rather
 * than referenced from another component.
 */
export interface VolumeBuilderProps extends Omit<
  VolumeProps,
  "availabilityZone" | "encryptionKey"
> {
  /**
   * Customer-managed KMS key (CMK) used to encrypt the volume.
   *
   * Accepts a concrete {@link IKey} or a {@link Ref} that resolves to one
   * at build time (e.g. a sibling key builder in the same composed system).
   *
   * @default - the account's default EBS KMS key, applied because
   *   `encrypted: true` is set in {@link VOLUME_DEFAULTS}.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_protect_data_rest_encrypt.html
   */
  encryptionKey?: Resolvable<IKey>;

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
   * Contextual alarms (`burstBalance`) are only created when the
   * corresponding volume configuration is present — e.g., a burstable
   * `gp2`/`st1`/`sc1` volume type.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
   */
  recommendedAlarms?: VolumeAlarmConfig | false;
}

/**
 * The build output of a {@link IVolumeBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface VolumeBuilderResult {
  volume: Volume;

  /**
   * CloudWatch alarms created for the volume, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via {@link IVolumeBuilder.addAlarm}. Access individual alarms by
   * key (e.g., `result.alarms.burstBalance`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an AWS EBS volume.
 *
 * Each configuration property from the CDK {@link VolumeProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The `availabilityZone` is set via the dedicated
 * {@link IVolumeBuilder.availabilityZone | .availabilityZone()} method that
 * accepts a {@link Resolvable} value for cross-component wiring (e.g., to
 * a sibling {@link IVpcBuilder}). The `encryptionKey` setter likewise
 * accepts a {@link Resolvable} value so a sibling KMS-key builder's output
 * can be supplied via {@link ref}.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * an EBS volume with the configured properties and returns a
 * {@link VolumeBuilderResult}.
 *
 * AWS-recommended CloudWatch alarms are created by default. Alarms can be
 * customized or disabled via the `recommendedAlarms` property. Custom
 * alarms can be added via the {@link addAlarm} method.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Volume.html
 *
 * @example
 * ```ts
 * const data = createVolumeBuilder()
 *   .availabilityZone(ref<VpcBuilderResult>("network").map(r => r.vpc.availabilityZones[0]))
 *   .size(Size.gibibytes(50));
 * ```
 */
export type IVolumeBuilder = ITaggedBuilder<VolumeBuilderProps, VolumeBuilder>;

class VolumeBuilder implements Lifecycle<VolumeBuilderResult> {
  props: Partial<VolumeBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<Volume>[] = [];
  #availabilityZone?: Resolvable<string>;

  /**
   * Sets the Availability Zone the volume will be created in.
   *
   * Accepts a concrete AZ string or a {@link Ref} that resolves to one at
   * build time. This is how cross-component wiring works — e.g., to a
   * sibling {@link IVpcBuilder} via
   * `ref<VpcBuilderResult>("network").map(r => r.vpc.availabilityZones[0])`.
   *
   * @param availabilityZone - The AZ string or a Ref to one.
   * @returns This builder for chaining.
   */
  availabilityZone(availabilityZone: Resolvable<string>): this {
    this.#availabilityZone = availabilityZone;
    return this;
  }

  /**
   * Adds a custom CloudWatch alarm to be created alongside the recommended
   * alarms. The provided callback receives an {@link AlarmDefinitionBuilder}
   * scoped to the built {@link Volume}; configure it fluently and return it.
   *
   * @param key - A unique key for the alarm (used to generate the alarm id).
   * @param configure - Callback that configures the alarm definition.
   * @returns This builder for chaining.
   */
  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<Volume>) => AlarmDefinitionBuilder<Volume>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<Volume>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: VolumeBuilder): void {
    target.#availabilityZone = this.#availabilityZone;
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): VolumeBuilderResult {
    const resolvedAz = this.#availabilityZone
      ? resolve(this.#availabilityZone, context)
      : undefined;

    if (resolvedAz === undefined) {
      throw new Error(
        `VolumeBuilder "${id}" requires an availability zone. ` +
          `Call .availabilityZone() with a string or a Ref to one.`,
      );
    }

    const { recommendedAlarms: alarmConfig, encryptionKey, ...volumeProps } = this.props;

    const mergedProps = {
      ...VOLUME_DEFAULTS,
      ...volumeProps,
      availabilityZone: resolvedAz,
      ...(encryptionKey !== undefined ? { encryptionKey: resolve(encryptionKey, context) } : {}),
    } as VolumeProps;

    const volume = new Volume(scope, id, mergedProps);

    const alarms = createVolumeAlarms(
      scope,
      id,
      volume,
      alarmConfig,
      mergedProps.volumeType,
      this.#customAlarms,
    );

    return { volume, alarms };
  }
}

/**
 * Creates a new {@link IVolumeBuilder} for configuring an AWS EBS volume.
 *
 * This is the entry point for defining an EBS volume component. The
 * returned builder exposes every {@link VolumeBuilderProps} property as a
 * fluent setter/getter, plus
 * {@link IVolumeBuilder.availabilityZone | .availabilityZone()} for
 * cross-component AZ wiring with Ref support. It implements
 * {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS EBS volume.
 *
 * @example
 * ```ts
 * const data = createVolumeBuilder()
 *   .availabilityZone(ref<VpcBuilderResult>("network").map(r => r.vpc.availabilityZones[0]))
 *   .size(Size.gibibytes(50));
 *
 * // Use standalone:
 * const result = data.build(stack, "Data", { network });
 *
 * // Or compose into a system:
 * const system = compose(
 *   { network: createVpcBuilder(), data },
 *   { network: [], data: ["network"] },
 * );
 * ```
 */
export function createVolumeBuilder(): IVolumeBuilder {
  return taggedBuilder<VolumeBuilderProps, VolumeBuilder>(VolumeBuilder);
}
