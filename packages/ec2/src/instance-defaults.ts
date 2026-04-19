import { BlockDeviceVolume, EbsDeviceVolumeType, type InstanceProps } from "aws-cdk-lib/aws-ec2";

/**
 * Secure, AWS-recommended defaults applied to every EC2 instance built with
 * {@link createInstanceBuilder}. Each property can be individually overridden
 * via the builder's fluent API.
 *
 * Three required properties intentionally have no default — they are
 * application-specific and must be supplied explicitly:
 *   - `vpc` (via the builder's `.vpc()` method)
 *   - `instanceType`
 *   - `machineImage`
 */
export const INSTANCE_DEFAULTS: Partial<InstanceProps> = {
  /**
   * Require IMDSv2. IMDSv1 is vulnerable to SSRF-based credential exfiltration;
   * IMDSv2 requires a session token and blocks the common attack pattern.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
   */
  requireImdsv2: true,

  /**
   * Enable detailed (1-minute) CloudWatch metrics. Without this, instance
   * metrics are emitted at 5-minute granularity, which makes short-window
   * alarm evaluation unreliable.
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-cloudwatch-new.html
   */
  detailedMonitoring: true,

  /**
   * Attach the AmazonSSMManagedInstanceCore managed policy so Session Manager
   * can be used in place of SSH. Removes the need for key pairs, bastion
   * hosts, or inbound SSH access.
   * @see https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
   */
  ssmSessionPermissions: true,

  /**
   * EBS-optimized networking — dedicated bandwidth between the instance and
   * its EBS volumes. Free and on-by-default for current-generation instance
   * types; set explicitly for consistency.
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-optimized.html
   */
  ebsOptimized: true,

  /**
   * Encrypt the root EBS volume at rest using the account's default EBS KMS
   * key. GP3 is the current-generation general-purpose volume type — cheaper
   * and faster than GP2 at equivalent sizes. Users override this to change
   * volume size, IOPS, throughput, or to add additional block devices.
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html
   */
  blockDevices: [
    {
      deviceName: "/dev/xvda",
      volume: BlockDeviceVolume.ebs(8, {
        encrypted: true,
        volumeType: EbsDeviceVolumeType.GP3,
      }),
    },
  ],
};
