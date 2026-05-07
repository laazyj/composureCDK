import { RemovalPolicy } from "aws-cdk-lib";
import { EbsDeviceVolumeType, type VolumeProps } from "aws-cdk-lib/aws-ec2";

/**
 * Secure, AWS-recommended defaults applied to every EBS volume built with
 * {@link createVolumeBuilder}. Each property can be individually overridden
 * via the builder's fluent API.
 *
 * Three properties intentionally have no default — they are application-
 * specific and must be supplied explicitly:
 *   - `availabilityZone` (via the builder's `.availabilityZone()` method)
 *   - `size`
 *   - `iops` / `throughput` (only when opting into a volume type that
 *     requires them, e.g. `io1`/`io2`)
 */
export const VOLUME_DEFAULTS: Partial<VolumeProps> = {
  /**
   * GP3 is the current-generation general-purpose SSD — cheaper and faster
   * than GP2 at equivalent sizes, and matches the root-volume choice in
   * {@link INSTANCE_DEFAULTS}.
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/general-purpose.html
   */
  volumeType: EbsDeviceVolumeType.GP3,

  /**
   * Encrypt the volume at rest. Defaults to the account's default EBS KMS
   * key; pass an `encryptionKey` to use a customer-managed key (CMK) for
   * sensitive workloads per SEC08-BP02.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_protect_data_rest_encrypt.html
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html
   */
  encrypted: true,

  /**
   * When EBS detects inconsistent data on boot it disables I/O until the
   * operator acknowledges. For a persistent data volume the safer default
   * is to let I/O resume so the instance can come up unattended; override
   * to `false` for workloads that prefer to block on potential corruption.
   * @see https://docs.aws.amazon.com/ebs/latest/userguide/monitoring-volume-events.html
   */
  autoEnableIo: true,

  /**
   * Mirrors `BUCKET_DEFAULTS.removalPolicy`. A destroyed volume is
   * unrecoverable; an orphaned volume is a $/month nuisance. Err on the
   * side of retention — flip to `DESTROY` explicitly for ephemeral data.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_planning_for_recovery_back_up_data.html
   */
  removalPolicy: RemovalPolicy.RETAIN,
};
