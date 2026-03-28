import { RemovalPolicy } from "aws-cdk-lib";
import { RetentionDays, type LogGroupProps } from "aws-cdk-lib/aws-logs";

/**
 * Secure, AWS-recommended defaults applied to every log group built with
 * {@link createLogGroupBuilder}. Each property can be individually overridden
 * via the builder's fluent API.
 */
export const LOG_GROUP_DEFAULTS: Partial<LogGroupProps> = {
  /**
   * Retain logs for two years. CloudWatch defaults to indefinite retention;
   * an explicit policy prevents unbounded log accumulation while preserving
   * a meaningful audit window.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  retention: RetentionDays.TWO_YEARS,

  /**
   * Retain the log group when the stack is deleted. Logs are operational
   * and audit records that should survive infrastructure teardown.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  removalPolicy: RemovalPolicy.RETAIN,
};
