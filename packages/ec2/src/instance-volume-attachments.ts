import { Duration, Token } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import {
  CfnVolumeAttachment,
  type Instance,
  type InstanceProps,
  type IVolume,
  type SelectedSubnets,
} from "aws-cdk-lib/aws-ec2";
import type { IConstruct } from "constructs";
import { resolve, type Resolvable } from "@composurecdk/core";
import { type AlarmDefinition, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { VolumeBuilderResult } from "./volume-builder.js";
import type { VolumeAttachmentAlarmConfig } from "./instance-volume-attachment-config.js";
import { VOLUME_ATTACHMENT_ALARM_DEFAULTS } from "./instance-volume-attachment-defaults.js";

const STALLED_IO_PERIOD = Duration.minutes(1);
const STALLED_IO_PERIOD_LABEL = `${String(STALLED_IO_PERIOD.toMinutes())} minute`;

/**
 * Reference to the volume to be attached. Either a sibling
 * {@link VolumeBuilderResult} (the common composed-system case) or a
 * concrete {@link IVolume} (for externally-managed volumes).
 */
export type AttachVolumeRef = Resolvable<VolumeBuilderResult> | Resolvable<IVolume>;

/**
 * Configuration for a single `attachVolume` call.
 */
export interface AttachVolumeOptions {
  /**
   * Linux device name to attach the volume as (e.g. `/dev/sdf`).
   *
   * The Linux kernel may rename this to `xvdf` etc. on the instance —
   * resolve mounts via UUID rather than the device path.
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html
   */
  device: string;

  /**
   * Configuration for the per-attachment recommended alarms.
   *
   * @default - alarms enabled with the defaults in
   *   {@link VOLUME_ATTACHMENT_ALARM_DEFAULTS}.
   */
  recommendedAlarms?: VolumeAttachmentAlarmConfig | false;
}

/**
 * Internal config captured by {@link IInstanceBuilder.attachVolume} and
 * forwarded to {@link createVolumeAttachments} at build time.
 *
 * @internal
 */
export interface PendingVolumeAttachment {
  key: string;
  volumeRef: AttachVolumeRef;
  options: AttachVolumeOptions;
}

function resolveInstanceAz(instanceProps: InstanceProps): string | undefined {
  if (instanceProps.availabilityZone && !Token.isUnresolved(instanceProps.availabilityZone)) {
    return instanceProps.availabilityZone;
  }

  let selected: SelectedSubnets;
  try {
    selected = instanceProps.vpc.selectSubnets(instanceProps.vpcSubnets);
  } catch {
    // selectSubnets() throws for several unrelated reasons (no matching subnets,
    // unresolved tokens, etc.). The validation is best-effort — if we can't
    // resolve a concrete AZ, fall through and let CFN surface the real failure.
    return undefined;
  }

  return selected.availabilityZones.find((az) => !Token.isUnresolved(az));
}

function unwrapVolume(resolved: VolumeBuilderResult | IVolume): IVolume {
  if ("volumeId" in resolved) {
    return resolved;
  }
  return resolved.volume;
}

function volumeAttachmentMetric(
  volume: IVolume,
  instance: Instance,
  metricName: string,
  statistic: string,
  period: Duration,
): Metric {
  return new Metric({
    namespace: "AWS/EBS",
    metricName,
    dimensionsMap: {
      VolumeId: volume.volumeId,
      InstanceId: instance.instanceId,
    },
    statistic,
    period,
  });
}

function resolveVolumeAttachmentAlarmDefinitions(
  attachmentKey: string,
  volume: IVolume,
  instance: Instance,
  config: VolumeAttachmentAlarmConfig | false | undefined,
): AlarmDefinition[] {
  if (config === false) return [];
  const enabled = config?.enabled ?? VOLUME_ATTACHMENT_ALARM_DEFAULTS.enabled;
  if (!enabled) return [];
  if (config?.volumeStalledIo === false) return [];

  const cfg = resolveAlarmConfig(
    config?.volumeStalledIo,
    VOLUME_ATTACHMENT_ALARM_DEFAULTS.volumeStalledIo,
  );

  return [
    {
      key: `${attachmentKey}.volumeStalledIo`,
      alarmName: cfg.alarmName,
      metric: volumeAttachmentMetric(
        volume,
        instance,
        "VolumeStalledIOCheck",
        Stats.MAXIMUM,
        STALLED_IO_PERIOD,
      ),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `EBS volume attachment "${attachmentKey}" is reporting a stalled I/O condition. ` +
        `Threshold: >= ${String(cfg.threshold)} (max) over ${String(cfg.evaluationPeriods)} x ${STALLED_IO_PERIOD_LABEL}. ` +
        `Note: VolumeStalledIOCheck is published only for Nitro-instance attachments.`,
    },
  ];
}

/**
 * Creates a {@link CfnVolumeAttachment} for each pending attachment and
 * (when configured) the per-attachment recommended alarms. Synth-time AZ
 * alignment is validated when both the volume's AZ and the instance's
 * effective AZ are concrete strings.
 *
 * @returns The created `CfnVolumeAttachment`s keyed by attachment key,
 *   plus the per-attachment alarms keyed by `${attachmentKey}.${alarmKey}`
 *   so they can be flat-merged into the instance's `alarms` record.
 */
export function createVolumeAttachments(
  scope: IConstruct,
  id: string,
  instance: Instance,
  instanceProps: InstanceProps,
  attachments: PendingVolumeAttachment[],
  context?: Record<string, object>,
): { attachments: Record<string, CfnVolumeAttachment>; alarms: Record<string, Alarm> } {
  const attachmentRecords: Record<string, CfnVolumeAttachment> = {};
  const alarmDefinitions: AlarmDefinition[] = [];

  // Resolve the instance AZ once — it is the same for every attachment.
  const instanceAz = attachments.length > 0 ? resolveInstanceAz(instanceProps) : undefined;

  for (const pending of attachments) {
    const resolved = resolve(pending.volumeRef, context);
    const volume = unwrapVolume(resolved);

    if (instanceAz !== undefined && !Token.isUnresolved(volume.availabilityZone)) {
      if (volume.availabilityZone !== instanceAz) {
        throw new Error(
          `attachVolume "${pending.key}": volume is in availability zone "${volume.availabilityZone}" ` +
            `but the instance is in "${instanceAz}". ` +
            `EBS volumes can only attach to instances in the same AZ.`,
        );
      }
    }

    const attachment = new CfnVolumeAttachment(scope, `${id}${pending.key}Attachment`, {
      device: pending.options.device,
      instanceId: instance.instanceId,
      volumeId: volume.volumeId,
    });
    attachmentRecords[pending.key] = attachment;

    alarmDefinitions.push(
      ...resolveVolumeAttachmentAlarmDefinitions(
        pending.key,
        volume,
        instance,
        pending.options.recommendedAlarms,
      ),
    );
  }

  const alarms = alarmDefinitions.length > 0 ? createAlarms(scope, id, alarmDefinitions) : {};
  return { attachments: attachmentRecords, alarms };
}
