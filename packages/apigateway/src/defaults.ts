import {
  type DomainNameOptions,
  MethodLoggingLevel,
  SecurityPolicy,
  type StageOptions,
} from "aws-cdk-lib/aws-apigateway";
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
export const REST_API_DEFAULTS = {
  /**
   * Automatically create an access log group with structured JSON output.
   * Access logging provides an audit trail of all API calls for security
   * monitoring and troubleshooting.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html
   */
  accessLogging: true,

  /**
   * Create the stage's execution log group in the stack, so it has a
   * retention policy rather than the never-expiring group API Gateway
   * creates on first write.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html
   */
  executionLogging: true,

  deployOptions: DEPLOY_OPTIONS_DEFAULTS,
} satisfies Partial<RestApiBuilderProps>;

/**
 * Secure, AWS-recommended defaults applied to every spec-driven REST API
 * built with {@link createSpecRestApiBuilder}. Each property can be
 * individually overridden via the builder's fluent API.
 */
export const SPEC_REST_API_DEFAULTS = {
  /**
   * Automatically create an access log group with structured JSON output.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-logging.html
   */
  accessLogging: true,

  /** Manage the stage's execution log group, so it has a retention policy. */
  executionLogging: true,

  deployOptions: DEPLOY_OPTIONS_DEFAULTS,
} satisfies Partial<SpecRestApiBuilderProps>;

/**
 * Secure defaults applied to a REST API's custom `domainName`, under the
 * options the user sets. Applied by both {@link createRestApiBuilder} and
 * {@link createSpecRestApiBuilder}, and only when a `domainName` is set.
 */
export const DOMAIN_NAME_DEFAULTS = {
  /**
   * Require TLS 1.2 as the minimum protocol version. CDK documents this as
   * its default but leaves the property out of the template; setting it makes
   * the TLS floor explicit in the synthesised `AWS::ApiGateway::DomainName`.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-in-transit.html
   */
  securityPolicy: SecurityPolicy.TLS_1_2,
} satisfies Partial<DomainNameOptions>;
