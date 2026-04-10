import { type RestApiBase, SpecRestApi, type SpecRestApiProps } from "aws-cdk-lib/aws-apigateway";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { RestApiBuilderPropsBase, RestApiBuilderResultBase } from "./builder-common.js";
import { SPEC_REST_API_DEFAULTS } from "./defaults.js";
import { resolveDeployOptions } from "./deploy-options.js";
import { createRestApiAlarms } from "./rest-api-alarms.js";

/**
 * Configuration properties for the spec-driven REST API builder.
 *
 * Extends the CDK {@link SpecRestApiProps} with additional builder-specific
 * options.
 */
export interface SpecRestApiBuilderProps extends SpecRestApiProps, RestApiBuilderPropsBase {}

/**
 * The build output of a {@link ISpecRestApiBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export type SpecRestApiBuilderResult = RestApiBuilderResultBase<SpecRestApi>;

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
  private readonly customAlarms: AlarmDefinitionBuilder<RestApiBase>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<RestApiBase>) => AlarmDefinitionBuilder<RestApiBase>,
  ): this {
    this.customAlarms.push(configure(new AlarmDefinitionBuilder<RestApiBase>(key)));
    return this;
  }

  build(scope: IConstruct, id: string): SpecRestApiBuilderResult {
    const { accessLogging, recommendedAlarms: alarmConfig, ...specRestApiProps } = this.props;
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

    const alarms = createRestApiAlarms(scope, id, api, alarmConfig, this.customAlarms);

    return { api, accessLogGroup, alarms };
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
