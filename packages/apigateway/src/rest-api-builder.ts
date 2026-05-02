import {
  type Integration,
  type MethodOptions,
  RestApi,
  type RestApiBase,
  type RestApiProps,
} from "aws-cdk-lib/aws-apigateway";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle, type Resolvable } from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { RestApiBuilderPropsBase, RestApiBuilderResultBase } from "./builder-common.js";
import { REST_API_DEFAULTS } from "./defaults.js";
import { resolveDeployOptions } from "./deploy-options.js";
import { ResourceBuilder } from "./resource-builder.js";
import { createRestApiAlarms } from "./rest-api-alarms.js";

/**
 * Configuration properties for the REST API builder.
 *
 * Extends the CDK {@link RestApiProps} with additional builder-specific options.
 */
export interface RestApiBuilderProps extends RestApiProps, RestApiBuilderPropsBase {}

/**
 * The build output of a {@link IRestApiBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export type RestApiBuilderResult = RestApiBuilderResultBase<RestApi>;

/**
 * A fluent builder for configuring and creating an API Gateway REST API.
 *
 * Configuration properties from CDK {@link RestApiProps} are exposed as
 * overloaded getter/setter methods via the builder proxy. The resource tree
 * (paths and HTTP methods) is defined using {@link addResource} and
 * {@link addMethod}, which accept the same arguments as their CDK equivalents.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a REST API with the configured properties and resource tree, and returns
 * a {@link RestApiBuilderResult}.
 *
 * @example
 * ```ts
 * const api = createRestApiBuilder()
 *   .restApiName("My Service")
 *   .description("Public API")
 *   .addResource("users", users => users
 *     .addMethod("GET", listUsersIntegration)
 *     .addResource("{id}", user => user
 *       .addMethod("GET", getUserIntegration)
 *     )
 *   );
 * ```
 */
export type IRestApiBuilder = IBuilder<RestApiBuilderProps, RestApiBuilder>;

class RestApiBuilder implements Lifecycle<RestApiBuilderResult> {
  props: Partial<RestApiBuilderProps> = {};
  readonly #root = new ResourceBuilder();
  readonly #customAlarms: AlarmDefinitionBuilder<RestApiBase>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<RestApiBase>) => AlarmDefinitionBuilder<RestApiBase>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<RestApiBase>(key)));
    return this;
  }

  /**
   * Adds an HTTP method to the API root resource (`/`).
   *
   * @param httpMethod - The HTTP verb (GET, POST, PUT, DELETE, etc.).
   * @param integration - The backend integration for this method. Accepts a concrete
   *   {@link Integration} or a {@link Ref} that resolves to one at build time.
   * @param options - Additional method configuration such as authorization or method responses.
   * @returns This builder for chaining.
   */
  addMethod(
    httpMethod: string,
    integration?: Resolvable<Integration>,
    options?: MethodOptions,
  ): this {
    this.#root.addMethod(httpMethod, integration, options);
    return this;
  }

  /**
   * Adds a child resource under the API root resource (`/`).
   *
   * @param pathPart - The path segment for the resource (e.g. "users" or "\{id\}").
   * @param configure - Optional callback to configure the resource's methods and nested resources.
   * @returns This builder for chaining.
   */
  addResource(pathPart: string, configure?: (resource: ResourceBuilder) => void): this {
    this.#root.addResource(pathPart, configure);
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): RestApiBuilderResult {
    const { accessLogging, recommendedAlarms: alarmConfig, ...restApiProps } = this.props;
    const { accessLogGroup, deployOptions } = resolveDeployOptions(
      scope,
      id,
      accessLogging,
      REST_API_DEFAULTS.deployOptions ?? {},
      restApiProps.deployOptions ?? {},
    );

    const api = new RestApi(scope, id, {
      ...restApiProps,
      deployOptions,
    });
    this.#root.applyTo(api.root, context ?? {});

    const alarms = createRestApiAlarms(scope, id, api, alarmConfig, this.#customAlarms);

    return { api, accessLogGroup, alarms };
  }
}

/**
 * Creates a new {@link IRestApiBuilder} for configuring an API Gateway REST API.
 *
 * This is the entry point for defining a REST API component. The returned
 * builder exposes every {@link RestApiProps} property as a fluent setter/getter,
 * plus {@link IRestApiBuilder.addResource | addResource} and
 * {@link IRestApiBuilder.addMethod | addMethod} for defining the resource tree.
 * It implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an API Gateway REST API.
 *
 * @example
 * ```ts
 * const api = createRestApiBuilder()
 *   .restApiName("My Service")
 *   .description("Public API")
 *   .addResource("users", users => users
 *     .addMethod("GET", listUsersIntegration)
 *     .addResource("{id}", user => user
 *       .addMethod("GET", getUserIntegration)
 *     )
 *   );
 *
 * // Use standalone:
 * const result = api.build(stack, "MyApi");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { api, handler: createFunctionBuilder() },
 *   { api: ["handler"], handler: [] },
 * );
 * ```
 */
export function createRestApiBuilder(): IRestApiBuilder {
  return Builder<RestApiBuilderProps, RestApiBuilder>(RestApiBuilder);
}
