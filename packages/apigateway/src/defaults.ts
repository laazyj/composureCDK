import { MethodLoggingLevel, type StageOptions } from "aws-cdk-lib/aws-apigateway";
import type { RestApiBuilderProps } from "./rest-api-builder.js";
import type { SpecRestApiBuilderProps } from "./spec-rest-api-builder.js";

/**
 * Secure, AWS-recommended deploy-stage defaults shared by all API Gateway
 * builders. Each property can be individually overridden via the builder's
 * fluent API.
 */
export const DEPLOY_OPTIONS_DEFAULTS: StageOptions = {
  /**
   * Enable AWS X-Ray tracing on the API Gateway stage.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-distributed-tracing.html
   */
  tracingEnabled: true,

  /**
   * Enable CloudWatch execution logging for API Gateway methods.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html
   */
  loggingLevel: MethodLoggingLevel.INFO,

  /**
   * Disable full request/response body logging to prevent sensitive data
   * from appearing in CloudWatch logs.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html
   */
  dataTraceEnabled: false,
};

/**
 * Secure, AWS-recommended defaults applied to every REST API built with
 * {@link createRestApiBuilder}. Each property can be individually overridden
 * via the builder's fluent API.
 */
export const REST_API_DEFAULTS: Partial<RestApiBuilderProps> = {
  /**
   * Automatically create an access log group with structured JSON output.
   * Access logging provides an audit trail of all API calls for security
   * monitoring and troubleshooting.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html
   */
  accessLogging: true,

  deployOptions: DEPLOY_OPTIONS_DEFAULTS,
};

/**
 * Secure, AWS-recommended defaults applied to every spec-driven REST API
 * built with {@link createSpecRestApiBuilder}. Each property can be
 * individually overridden via the builder's fluent API.
 */
export const SPEC_REST_API_DEFAULTS: Partial<SpecRestApiBuilderProps> = {
  /**
   * Automatically create an access log group with structured JSON output.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html
   */
  accessLogging: true,

  deployOptions: DEPLOY_OPTIONS_DEFAULTS,
};
