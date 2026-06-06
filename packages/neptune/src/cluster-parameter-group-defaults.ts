import { EngineVersion, ParameterGroupFamily } from "@aws-cdk/aws-neptune-alpha";

/**
 * Default parameters applied to the cluster parameter group the builder
 * auto-creates when the caller does not supply their own. These change
 * engine behaviour (not just observability), so each is documented and
 * individually overridable via `.clusterParameters({...})`.
 *
 * `neptune_enable_audit_log` is what actually turns audit logging on inside
 * the engine — without it, the `cloudwatchLogsExports: [AUDIT]` cluster
 * default creates an empty log stream. The two defaults are deliberately
 * paired so audit logging works end-to-end out of the box.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
 * @see https://docs.aws.amazon.com/neptune/latest/userguide/auditing.html#auditing-enable
 */
export const CLUSTER_PARAMETER_GROUP_DEFAULTS: Record<string, string> = {
  /** Enable engine audit logging so the audit log export carries data. */
  neptune_enable_audit_log: "1",
};

/**
 * Derives the cluster parameter group family from a Neptune engine version.
 *
 * A cluster parameter group must declare a family compatible with the
 * cluster's engine version, or the deploy fails. Rather than make the caller
 * keep the two in sync by hand, the builder derives the family from the
 * `engineVersion` (when set) so the auto-created parameter group is always
 * compatible. When no engine version is pinned, Neptune uses a current
 * 1.4.x engine, so the family defaults to {@link ParameterGroupFamily.NEPTUNE_1_4}.
 *
 * @see https://docs.aws.amazon.com/neptune/latest/userguide/parameters.html
 */
export function clusterParameterGroupFamily(engineVersion?: EngineVersion): ParameterGroupFamily {
  // version strings are "major.minor.patch.build", e.g. "1.4.5.1".
  const [major, minor] = (engineVersion?.version ?? "1.4").split(".");
  const majorMinor = `${major}.${minor}`;
  switch (majorMinor) {
    case "1.0":
    case "1.1":
      return ParameterGroupFamily.NEPTUNE_1;
    case "1.2":
      return ParameterGroupFamily.NEPTUNE_1_2;
    case "1.3":
      return ParameterGroupFamily.NEPTUNE_1_3;
    default:
      // 1.4 and anything newer the builder has not been taught about yet.
      return ParameterGroupFamily.NEPTUNE_1_4;
  }
}
