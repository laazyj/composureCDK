import { type RestApiBase, SpecRestApi, type SpecRestApiProps } from "aws-cdk-lib/aws-apigateway";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { RestApiBuilderPropsBase, RestApiBuilderResultBase } from "./builder-common.js";
import { SPEC_REST_API_DEFAULTS } from "./defaults.js";
import { resolveDeployOptions } from "./deploy-options.js";
import { createRestApiAlarms } from "./rest-api-alarms.js";

/**
 * Configuration properties for the spec-driven REST API builder.
 *
 * Extends the CDK {@link SpecRestApiProps} with additional builder-specific
 * options. `apiDefinition` is widened to a {@link Resolvable} so the
 * specification can be assembled from sibling components at build time; it
 * reads its inner type from CDK's own prop rather than naming `ApiDefinition`,
 * so it keeps tracking the installed `aws-cdk-lib` (ADR-0018).
 */
export interface SpecRestApiBuilderProps
  extends Omit<SpecRestApiProps, "apiDefinition">, RestApiBuilderPropsBase {
  /**
   * The OpenAPI specification that defines the API.
   *
   * Accepts a concrete `ApiDefinition` or a {@link Resolvable} — a
   * {@link ref} or {@link combine} that produces one once its dependencies
   * have been built. A resolvable definition is how a spec whose integrations
   * name sibling resources (a Lambda ARN to invoke, the role API Gateway
   * assumes to invoke it) stays inside `compose`: the values are unknown when
   * the builder is configured and only exist after the siblings are built.
   *
   * For the common case — an inline document whose placeholders stand for
   * sibling resources — {@link inlineSpecDefinition} assembles the whole thing
   * in one call.
   *
   * @example
   * ```ts
   * // Concrete — the spec needs nothing from its siblings
   * .apiDefinition(ApiDefinition.fromInline(spec))
   *
   * // Resolvable — the spec is finished once the handler exists
   * .apiDefinition(
   *   ref("handler", (r: FunctionBuilderResult) =>
   *     ApiDefinition.fromInline(substituteSpec(spec, {
   *       "${Handler.Arn}": r.function.functionArn,
   *     }))),
   * )
   * ```
   */
  apiDefinition?: Resolvable<NonNullable<SpecRestApiProps["apiDefinition"]>>;
}

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
 * {@link SpecRestApiBuilderProps.apiDefinition | apiDefinition}.
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
export type ISpecRestApiBuilder = ITaggedBuilder<SpecRestApiBuilderProps, SpecRestApiBuilder>;

class SpecRestApiBuilder implements Lifecycle<SpecRestApiBuilderResult> {
  props: Partial<SpecRestApiBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<RestApiBase>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<RestApiBase>) => AlarmDefinitionBuilder<RestApiBase>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<RestApiBase>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: SpecRestApiBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): SpecRestApiBuilderResult {
    const {
      accessLogging,
      recommendedAlarms: alarmConfig,
      apiDefinition,
      ...specRestApiProps
    } = this.props;

    if (!apiDefinition) {
      throw new Error(
        `SpecRestApiBuilder "${id}" requires an apiDefinition. ` +
          `Call .apiDefinition() with an ApiDefinition or a Ref to one.`,
      );
    }

    // Resolved before anything is created, so an unresolvable ref fails
    // without leaving a half-built access log group in the scope.
    const resolvedDefinition = resolve(apiDefinition, context);

    const { accessLogGroup, deployOptions } = resolveDeployOptions(
      scope,
      id,
      accessLogging,
      SPEC_REST_API_DEFAULTS.deployOptions,
      specRestApiProps.deployOptions ?? {},
      context,
    );

    const api = new SpecRestApi(scope, id, {
      ...specRestApiProps,
      apiDefinition: resolvedDefinition,
      deployOptions,
    });

    const alarms = createRestApiAlarms(scope, id, api, alarmConfig, this.#customAlarms);

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
 * entirely by the OpenAPI specification passed to
 * {@link SpecRestApiBuilderProps.apiDefinition | apiDefinition}. Use CDK's
 * `ApiDefinition` static methods to load the spec from an inline object,
 * a local file, or an S3 bucket.
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
  return taggedBuilder<SpecRestApiBuilderProps, SpecRestApiBuilder>(SpecRestApiBuilder);
}
