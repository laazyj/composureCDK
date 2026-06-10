import { RemovalPolicy, Duration } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { LogType, type DatabaseClusterProps } from "@aws-cdk/aws-neptune-alpha";

/**
 * Secure, AWS-recommended defaults applied to every Neptune cluster built
 * with {@link createClusterBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * Every default is anchored first to the AWS Well-Architected Framework
 * (the _why_) and then to the Neptune User Guide (the _how_), matching the
 * citation convention used across the other builder packages.
 *
 * Notably absent: `instanceType`. Defaulting an instance type would create
 * surprise cost, so the builder requires the caller to pick one explicitly
 * (a provisioned class such as `InstanceType.R6G_LARGE`, or
 * `InstanceType.SERVERLESS` paired with `serverlessScalingConfiguration`).
 *
 * @see https://docs.aws.amazon.com/prescriptive-guidance/latest/neptune-well-architected-framework/introduction.html
 */
export const CLUSTER_DEFAULTS: Partial<DatabaseClusterProps> = {
  /**
   * Encrypt the cluster volume at rest. Uses the AWS-managed Neptune key
   * unless a customer-managed key is supplied via `.kmsKey()`.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_protect_data_rest_encrypt.html
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/encrypt.html
   */
  storageEncrypted: true,

  /**
   * Require IAM authentication for data-plane connections, removing the
   * need for long-lived static credentials. Pair with `.allowAccessFrom()`
   * (or `cluster.grantConnect()`) to authorise principals.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/framework/sec-03.html
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/iam-auth.html
   */
  iamAuthentication: true,

  /**
   * Retain the cluster on stack deletion/replacement so graph data is not
   * destroyed by an errant `cdk destroy`. Ephemeral/dev stacks override to
   * `RemovalPolicy.DESTROY`.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_backing_up_data_identified_backups_data.html
   */
  removalPolicy: RemovalPolicy.RETAIN,

  /**
   * Block accidental deletion of the cluster itself. The CDK L2 would infer
   * this from `RemovalPolicy.RETAIN`; setting it explicitly keeps the
   * security posture auditable rather than implicit.
   * @see https://docs.aws.amazon.com/securityhub/latest/userguide/neptune-controls.html
   */
  deletionProtection: true,

  /**
   * Retain automated backups for 7 days. The CDK default is 1 day; AWS
   * Well-Architected recommends a longer window for production data.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_backing_up_data_automated_backups_data.html
   */
  backupRetention: Duration.days(7),

  /**
   * Export audit logs to CloudWatch Logs. Audit logging is the only log
   * type Neptune exports to CloudWatch, and it only emits once
   * `neptune_enable_audit_log` is set on the cluster parameter group — which
   * the builder's auto-created parameter group does by default.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/auditing.html
   */
  cloudwatchLogsExports: [LogType.AUDIT],

  /**
   * Expire exported audit logs after one month, matching the
   * `@composurecdk/logs` retention default rather than keeping them forever.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/framework/cost-05.html
   */
  cloudwatchLogsRetention: RetentionDays.ONE_MONTH,

  /**
   * Copy cluster tags onto automated snapshots so cost-allocation and
   * ownership tags survive into backups.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/framework/ops-04.html
   */
  copyTagsToSnapshot: true,

  /**
   * Apply patched minor engine versions automatically during the
   * maintenance window.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_protect_compute_validate_software_integrity.html
   */
  autoMinorVersionUpgrade: true,
};
