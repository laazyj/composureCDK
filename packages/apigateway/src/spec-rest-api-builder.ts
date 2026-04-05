import { SpecRestApi, type SpecRestApiProps } from "aws-cdk-lib/aws-apigateway";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { SPEC_REST_API_DEFAULTS } from "./defaults.js";
import { resolveDeployOptions } from "./deploy-options.js";

/**
 * Configuration properties for the spec-driven REST API builder.
 *
 * Extends the CDK {@link SpecRestApiProps} with additional builder-specific
 * options.
 */
export interface SpecRestApiBuilderProps extends SpecRestApiProps {
  /**
   * Whether to automatically create a CloudWatch log group for access logging.
   *
   * When `true`, the builder creates a log group using
   * {@link createLogGroupBuilder} (with its secure defaults) and configures it
   * as the stage's access log destination with JSON-formatted output. The
   * created log group is returned in the build result as `accessLogGroup`.
   *
   * When `false`, no access log group is created. You can still provide your
   * own destination via `deployOptions.accessLogDestination`.
   *
   * This setting is ignored when `deployOptions.accessLogDestination` is
   * provided — the user-supplied destination takes precedence.
   */
  accessLogging?: boolean;
}

/**
 * The build output of a {@link ISpecRestApiBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface SpecRestApiBuilderResult {
  /** The spec-driven REST API construct created by the builder. */
  api: SpecRestApi;

  /**
   * The CloudWatch log group created for access logging, or `undefined` if
   * access logging was disabled or the user provided their own destination.
   */
  accessLogGroup?: LogGroup;
}

/**
 * A fluent builder for configuring and creating an API Gateway REST API from
 * an OpenAPI specification.
 *
 * Configuration properties from CDK {@link SpecRestApiProps} are exposed as
 * overloaded getter/setter methods via the builder proxy. The API structure
 * is defined entirely by the OpenAPI specification provided via
 * {@link apiDefinition}.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a {@link SpecRestApi} with the configured properties and returns a
 * {@link SpecRestApiBuilderResult}.
 *
 * @example
 * ```ts
 * const api = createSpecRestApiBuilder()
 *   .restApiName("PetStore")
 *   .apiDefinition(ApiDefinition.fromAsset("openapi/petstore.yaml"));
 * ```
 */
export type ISpecRestApiBuilder = IBuilder<SpecRestApiBuilderProps, SpecRestApiBuilder>;

class SpecRestApiBuilder implements Lifecycle<SpecRestApiBuilderResult> {
  props: Partial<SpecRestApiBuilderProps> = {};

  build(scope: IConstruct, id: string): SpecRestApiBuilderResult {
    const { accessLogging, ...specRestApiProps } = this.props;
    const { accessLogGroup, deployOptions } = resolveDeployOptions(
      scope,
      id,
      accessLogging,
      SPEC_REST_API_DEFAULTS.deployOptions ?? {},
      specRestApiProps.deployOptions ?? {},
    );

    const api = new SpecRestApi(scope, id, {
      ...specRestApiProps,
      deployOptions,
    } as SpecRestApiProps);
    return { api, accessLogGroup };
  }
}

/**
 * Creates a new {@link ISpecRestApiBuilder} for configuring an API Gateway
 * REST API from an OpenAPI specification.
 *
 * This is the entry point for defining a spec-driven REST API component. The
 * returned builder exposes every {@link SpecRestApiProps} property as a fluent
 * setter/getter. It implements {@link Lifecycle} for use with {@link compose}.
 *
 * The API structure — resources, methods, and integrations — is defined
 * entirely by the OpenAPI specification passed to {@link apiDefinition}.
 * Use CDK's {@link ApiDefinition} static methods to load the spec from an
 * inline object, a local file, or an S3 bucket.
 *
 * @returns A fluent builder for a spec-driven API Gateway REST API.
 *
 * @example
 * ```ts
 * // From a local OpenAPI file
 * const api = createSpecRestApiBuilder()
 *   .restApiName("PetStore")
 *   .apiDefinition(ApiDefinition.fromAsset("openapi/petstore.yaml"));
 *
 * // From an inline definition
 * const api = createSpecRestApiBuilder()
 *   .restApiName("PetStore")
 *   .apiDefinition(ApiDefinition.fromInline({
 *     openapi: "3.0.2",
 *     info: { title: "PetStore", version: "1.0" },
 *     paths: { "/pets": { get: { ... } } },
 *   }));
 *
 * // Compose into a system
 * const system = compose(
 *   { api },
 *   { api: [] },
 * );
 * ```
 */
export function createSpecRestApiBuilder(): ISpecRestApiBuilder {
  return Builder<SpecRestApiBuilderProps, SpecRestApiBuilder>(SpecRestApiBuilder);
}
