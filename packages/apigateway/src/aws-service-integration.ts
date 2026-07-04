import {
  AwsIntegration,
  type IntegrationOptions,
  type IntegrationResponse,
  type IResource,
  type PassthroughBehavior,
} from "aws-cdk-lib/aws-apigateway";
import { type IGrantable, type IRole, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type Grant, GrantQueue, resolve, type Resolvable } from "@composurecdk/core";
import { createServiceRoleBuilder, type IRoleBuilder } from "@composurecdk/iam";

/**
 * Brand marking an object as an {@link IAwsServiceIntegration}. Recognised via
 * `Symbol.for(...)` rather than `instanceof` so the check survives the dual
 * ESM/CJS package hazard (see ADR-0007), matching how `core` brands a `Ref`.
 */
export const AWS_SERVICE_INTEGRATION = Symbol.for("composurecdk.apigateway.awsServiceIntegration");

/**
 * Static, non-{@link Resolvable} properties of the underlying CDK
 * {@link AwsIntegration}. These rarely reference a sibling component, so they
 * are set as plain values rather than through a `ref(...)`.
 */
export interface AwsServiceIntegrationProps {
  /**
   * The HTTP method API Gateway uses to call the AWS service action. Defaults
   * to CDK's `AwsIntegration` default (`POST`) when omitted.
   */
  integrationHttpMethod?: string;
  /** The region of the integrated AWS service (defaults to the API's region). */
  region?: string;
  /** A service subdomain (e.g. a bucket name for S3 path-style access). */
  subdomain?: string;
  /** The resource path used in the integration URI. Mutually exclusive with `action`. */
  path?: string;
  /** Whether this is a proxy integration passing the request through unmodified. */
  proxy?: boolean;
  /** URL-encoded key/value parameters for the action. */
  actionParameters?: Record<string, string>;
}

/** The result of building an {@link IAwsServiceIntegration}. */
export interface AwsServiceIntegrationBuildResult {
  /** The CDK integration, with `credentialsRole` set to the owned {@link role}. */
  integration: AwsIntegration;
  /**
   * The IAM credentials role API Gateway assumes to call the service. Either
   * the role the builder created (assumed by `apigateway.amazonaws.com`) or the
   * external role supplied via {@link IAwsServiceIntegration.role}.
   */
  role: IRole;
}

/**
 * A branded, buildable AWS-service integration. Unlike a concrete
 * {@link import("aws-cdk-lib/aws-apigateway").Integration} or a `ref(...)` (both
 * of which resolve without a construct scope), this owns a credentials role and
 * so needs a build-time scope — hence its own {@link build} rather than the
 * plain `resolve` path. `RestApiBuilder` detects the {@link AWS_SERVICE_INTEGRATION}
 * brand in `addMethod` and calls `build` with the owning resource as scope.
 */
export interface IAwsServiceIntegration {
  readonly [AWS_SERVICE_INTEGRATION]: true;

  /**
   * Materialises the integration and its credentials role.
   *
   * @param scope - The owning API Gateway {@link IResource}. Used as the
   *   construct scope for the credentials role and to reach the REST API (for
   *   the confused-deputy trust condition) via `scope.api`.
   * @param id - A per-method identifier unique within `scope` (the HTTP verb).
   * @param context - Resolved dependency outputs, keyed by component name.
   */
  build(
    scope: IResource,
    id: string,
    context: Record<string, object>,
  ): AwsServiceIntegrationBuildResult;
}

/** Narrows an unknown `addMethod` argument to an {@link IAwsServiceIntegration}. */
export function isAwsServiceIntegration(value: unknown): value is IAwsServiceIntegration {
  return typeof value === "object" && value !== null && AWS_SERVICE_INTEGRATION in value;
}

const API_GATEWAY_SERVICE_PRINCIPAL = "apigateway.amazonaws.com";

class AwsServiceIntegrationBuilder implements IAwsServiceIntegration {
  readonly [AWS_SERVICE_INTEGRATION] = true as const;

  readonly #service: string;
  readonly #action: string;
  readonly #awsProps: AwsServiceIntegrationProps = {};
  readonly #options: ((context: Record<string, object>) => IntegrationOptions)[] = [];
  readonly #grants = new GrantQueue<IGrantable>();
  #role?: Resolvable<IRole>;
  #configureRole?: (rb: IRoleBuilder) => unknown;
  #restrictToApi = true;

  constructor(service: string, action: string) {
    this.#service = service;
    this.#action = action;
  }

  /**
   * Set the VTL request templates, keyed by content type. Accepts a
   * {@link Resolvable} so the template can read a sibling's build output, e.g.
   * `ref("table", (r) => ({ "application/json": vtl(r.table.tableName) }))`.
   */
  requestTemplates(templates: Resolvable<Record<string, string>>): this {
    this.#options.push((context) => ({ requestTemplates: resolve(templates, context) }));
    return this;
  }

  /** Set the integration request parameters. Accepts a {@link Resolvable}. */
  requestParameters(parameters: Resolvable<Record<string, string>>): this {
    this.#options.push((context) => ({ requestParameters: resolve(parameters, context) }));
    return this;
  }

  /** Set the integration responses (status mapping, response templates). */
  integrationResponses(responses: Resolvable<IntegrationResponse[]>): this {
    this.#options.push((context) => ({ integrationResponses: resolve(responses, context) }));
    return this;
  }

  /** Set the passthrough behaviour for unmatched content types. */
  passthroughBehavior(behavior: PassthroughBehavior): this {
    this.#options.push(() => ({ passthroughBehavior: behavior }));
    return this;
  }

  /**
   * Merge an arbitrary {@link IntegrationOptions} object. A catch-all for
   * options without a dedicated setter; later calls override earlier keys.
   * The builder always sets `credentialsRole` itself, so a `credentialsRole`
   * here is ignored — use {@link role} to supply an external role instead.
   */
  options(options: Resolvable<IntegrationOptions>): this {
    this.#options.push((context) => resolve(options, context));
    return this;
  }

  /** Set the static {@link AwsServiceIntegrationProps} (region, HTTP method, etc.). */
  configure(configure: (props: AwsServiceIntegrationProps) => void): this {
    configure(this.#awsProps);
    return this;
  }

  /**
   * Supply an external credentials role instead of letting the builder create
   * one. The caller then owns the role's trust policy and permissions; the
   * builder's confused-deputy default does not apply. Mutually exclusive with
   * {@link configureRole}.
   */
  role(role: Resolvable<IRole>): this {
    this.#role = role;
    return this;
  }

  /**
   * Extend the credentials-role builder the integration constructs (add inline
   * policies, description, override the trust policy, etc.). Mutually exclusive
   * with {@link role}.
   */
  configureRole(configure: (rb: IRoleBuilder) => unknown): this {
    this.#configureRole = configure;
    return this;
  }

  /**
   * Whether to scope the credentials-role trust policy to the owning API via an
   * `aws:SourceArn` condition (confused-deputy mitigation). Defaults to `true`;
   * pass `false` to allow any `apigateway.amazonaws.com` caller to assume the role.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html
   */
  restrictToApi(enabled: boolean): this {
    this.#restrictToApi = enabled;
    return this;
  }

  /**
   * Grant the owned credentials role access to a resource built by a sibling
   * component. The grant is declared on the consumer (this integration) so the
   * dependency edge points from the API to the resource — never a reverse edge.
   * Each {@link Grant} comes from a resource package's capability helper and is
   * applied during {@link build}.
   *
   * @see ADR-0013
   *
   * @example
   * ```ts
   * awsServiceIntegration("dynamodb", "Scan")
   *   .grant(tableGrants.readWrite(ref("table", (r) => r.table)));
   * // Declare the API's dependency on the table in compose:
   * // compose({ api, table }, { api: ["table"], table: [] })
   * ```
   */
  grant(...grants: Grant<IGrantable>[]): this {
    this.#grants.add(...grants);
    return this;
  }

  build(
    scope: IResource,
    id: string,
    context: Record<string, object>,
  ): AwsServiceIntegrationBuildResult {
    if (this.#role !== undefined && this.#configureRole !== undefined) {
      throw new Error(
        `AwsServiceIntegration "${id}": .role() and .configureRole() are mutually exclusive`,
      );
    }

    const role =
      this.#role !== undefined ? resolve(this.#role, context) : this.#buildRole(scope, id, context);

    // The role is an IGrantable, so queued grants land on the owned credentials
    // role — the identity API Gateway assumes to call the service.
    this.#grants.applyTo(role, context);

    const options = this.#options.reduce<IntegrationOptions>(
      (merged, next) => ({ ...merged, ...next(context) }),
      {},
    );

    const integration = new AwsIntegration({
      service: this.#service,
      action: this.#action,
      ...this.#awsProps,
      options: { ...options, credentialsRole: role },
    });

    return { integration, role };
  }

  #buildRole(scope: IResource, id: string, context: Record<string, object>): IRole {
    const principal = this.#restrictToApi
      ? new ServicePrincipal(API_GATEWAY_SERVICE_PRINCIPAL, {
          conditions: { ArnLike: { "aws:SourceArn": scope.api.arnForExecuteApi() } },
        })
      : new ServicePrincipal(API_GATEWAY_SERVICE_PRINCIPAL);

    const roleBuilder = createServiceRoleBuilder(API_GATEWAY_SERVICE_PRINCIPAL).assumedBy(
      principal,
    );
    this.#configureRole?.(roleBuilder);
    return roleBuilder.build(scope, `${id}CredentialsRole`, context).role;
  }
}

/**
 * Creates a first-class AWS-service integration for an API Gateway method:
 * a direct API Gateway → AWS service call (e.g. DynamoDB, SQS, S3) that owns
 * its credentials role and is a grantee.
 *
 * The integration creates a least-privilege IAM role assumed by
 * `apigateway.amazonaws.com` (scoped to the owning API by default), sets it as
 * the integration's `credentialsRole`, and exposes {@link IAwsServiceIntegration}'s
 * `grant(...)` so permissions are declared on the consumer per ADR-0013. Pass
 * the returned value straight to `addMethod` — `RestApiBuilder` detects it and
 * builds the role under the method's resource scope, surfacing it on
 * `RestApiBuilderResult.integrationRoles`.
 *
 * @param service - The AWS service namespace, e.g. `"dynamodb"`.
 * @param action - The service action, e.g. `"Scan"`.
 *
 * @example
 * ```ts
 * const scan = awsServiceIntegration("dynamodb", "Scan")
 *   .requestTemplates(ref("table", (r) => ({ "application/json": scanTemplate(r.table.tableName) })))
 *   .grant(tableGrants.read(ref("table", (r) => r.table)));
 *
 * compose(
 *   { table: createTableBuilder(), api: createRestApiBuilder().addResource("gadgets", (g) => g.addMethod("GET", scan)) },
 *   { table: [], api: ["table"] },
 * );
 * ```
 */
export function awsServiceIntegration(
  service: string,
  action: string,
): AwsServiceIntegrationBuilder {
  return new AwsServiceIntegrationBuilder(service, action);
}
