import { LoggingFormat, Tracing, type FunctionProps } from "aws-cdk-lib/aws-lambda";

/**
 * Secure, AWS-recommended defaults applied to every Lambda function built
 * with {@link createFunctionBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const FUNCTION_DEFAULTS: Partial<FunctionProps> = {
  /**
   * Enable AWS X-Ray active tracing for distributed request tracking.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-distributed-tracing.html
   */
  tracing: Tracing.ACTIVE,

  /**
   * Emit logs as structured JSON for CloudWatch Logs Insights auto-discovery
   * and consistent querying across services.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html
   */
  loggingFormat: LoggingFormat.JSON,
};
