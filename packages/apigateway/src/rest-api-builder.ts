import {
  AccessLogFormat,
  type Integration,
  LogGroupLogDestination,
  type MethodOptions,
  RestApi,
  type RestApiProps,
} from "aws-cdk-lib/aws-apigateway";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle, type Resolvable } from "@composurecdk/core";
import { createLogGroupBuilder } from "@composurecdk/logs";
import { ResourceBuilder } from "./resource-builder.js";
import { REST_API_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the REST API builder.
 *
 * Extends the CDK {@link RestApiProps} with additional builder-specific options.
 */
export interface RestApiBuilderProps extends RestApiProps {
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
 * The build output of a {@link IRestApiBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface RestApiBuilderResult {
  /** The REST API construct created by the builder. */
  api: RestApi;

  /**
   * The CloudWatch log group created for access logging, or `undefined` if
   * access logging was disabled or the user provided their own destination.
   */
  accessLogGroup?: LogGroup;
}

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
  private readonly root = new ResourceBuilder();

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
    this.root.addMethod(httpMethod, integration, options);
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
    this.root.addResource(pathPart, configure);
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): RestApiBuilderResult {
    const { accessLogging, ...restApiProps } = this.props;
    const userDeployOptions = restApiProps.deployOptions ?? {};
    const autoAccessLog =
      (accessLogging ?? REST_API_DEFAULTS.accessLogging) && !userDeployOptions.accessLogDestination;

    let accessLogGroup: LogGroup | undefined;
    let accessLogProps = {};

    if (autoAccessLog) {
      accessLogGroup = createLogGroupBuilder().build(scope, `${id}AccessLogs`).logGroup;
      accessLogProps = {
        accessLogDestination: new LogGroupLogDestination(accessLogGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
      };
    }

    const mergedProps = {
      ...restApiProps,
      deployOptions: {
        ...REST_API_DEFAULTS.deployOptions,
        ...accessLogProps,
        ...userDeployOptions,
      },
    } as RestApiProps;

    const api = new RestApi(scope, id, mergedProps);
    this.root.applyTo(api.root, context ?? {});
    return { api, accessLogGroup };
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
