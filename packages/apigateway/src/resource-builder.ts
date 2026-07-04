import { type Integration, type IResource, type MethodOptions } from "aws-cdk-lib/aws-apigateway";
import type { IRole } from "aws-cdk-lib/aws-iam";
import { resolve, type Resolvable } from "@composurecdk/core";
import { type IAwsServiceIntegration, isAwsServiceIntegration } from "./aws-service-integration.js";

/**
 * The integration a method can be given: a concrete or `ref`-wrapped CDK
 * {@link Integration}, or a branded {@link IAwsServiceIntegration} that owns its
 * credentials role and is built (rather than merely resolved) at apply time.
 */
export type MethodIntegration = Resolvable<Integration> | IAwsServiceIntegration;

interface MethodDefinition {
  httpMethod: string;
  integration?: MethodIntegration;
  options?: MethodOptions;
}

interface ResourceDefinition {
  methods: MethodDefinition[];
  children: Map<string, ResourceDefinition>;
}

/**
 * A declarative builder for defining API Gateway resources and methods.
 *
 * `ResourceBuilder` captures a tree of resource paths and HTTP methods as
 * data. The tree is applied to actual CDK constructs during
 * {@link RestApiBuilder.build}. Users do not construct `ResourceBuilder`
 * directly — instances are provided via the {@link IRestApiBuilder.addResource}
 * callback.
 *
 * @example
 * ```ts
 * createRestApiBuilder()
 *   .addResource("users", users => users
 *     .addMethod("GET", listIntegration)
 *     .addResource("{id}", user => user
 *       .addMethod("GET", getIntegration)
 *       .addMethod("DELETE", deleteIntegration)
 *     )
 *   );
 * ```
 */
export class ResourceBuilder {
  /** @internal */
  readonly definition: ResourceDefinition = { methods: [], children: new Map() };

  /**
   * Adds an HTTP method to this resource.
   *
   * @param httpMethod - The HTTP verb (GET, POST, PUT, DELETE, etc.).
   * @param integration - The backend integration for this method. Accepts a
   *   concrete {@link Integration}, a {@link Ref} that resolves to one at build
   *   time, or an {@link awsServiceIntegration} that owns its credentials role.
   * @param options - Additional method configuration such as authorization or method responses.
   * @returns This builder for chaining.
   */
  addMethod(httpMethod: string, integration?: MethodIntegration, options?: MethodOptions): this {
    this.definition.methods.push({ httpMethod, integration, options });
    return this;
  }

  /**
   * Adds a child resource under this resource.
   *
   * @param pathPart - The path segment for the child resource (e.g. "users" or "\{id\}").
   * @param configure - Optional callback to configure the child resource's methods and nested resources.
   * @returns This builder for chaining.
   */
  addResource(pathPart: string, configure?: (resource: ResourceBuilder) => void): this {
    const child = new ResourceBuilder();
    if (configure) {
      configure(child);
    }
    this.definition.children.set(pathPart, child.definition);
    return this;
  }

  /**
   * Copies this builder's resource tree onto `target`. Used by
   * `RestApiBuilder.[COPY_STATE]` per ADR-0005's containers-fresh,
   * elements-shared rule: the `methods` array and `children` Map are
   * reconstructed on `target`, but `MethodDefinition` and child
   * `ResourceDefinition` entries are shared by reference. Sharing the
   * child entries is safe because the public API (`addResource`)
   * replaces a child wholesale rather than mutating it in place.
   *
   * @internal
   */
  copyInto(target: ResourceBuilder): void {
    target.definition.methods.push(...this.definition.methods);
    for (const [pathPart, childDef] of this.definition.children) {
      target.definition.children.set(pathPart, childDef);
    }
  }

  /**
   * Materialises the resource tree onto CDK constructs. Branded AWS-service
   * integrations are built here (they own a credentials role and need the
   * `resource` as construct scope) rather than merely resolved; each created
   * role is recorded in `integrationRoles`, keyed by `"{resource.path} {method}"`,
   * so `RestApiBuilder.build` can surface it in the result.
   *
   * @internal
   */
  applyTo(
    resource: IResource,
    context: Record<string, object> = {},
    integrationRoles: Record<string, IRole> = {},
  ): void {
    for (const method of this.definition.methods) {
      let integration: Integration | undefined;
      if (isAwsServiceIntegration(method.integration)) {
        const built = method.integration.build(resource, method.httpMethod, context);
        integration = built.integration;
        integrationRoles[`${resource.path} ${method.httpMethod}`] = built.role;
      } else if (method.integration !== undefined) {
        integration = resolve(method.integration, context);
      }
      resource.addMethod(method.httpMethod, integration, method.options);
    }
    for (const [pathPart, childDef] of this.definition.children) {
      const childResource = resource.addResource(pathPart);
      const childBuilder = new ResourceBuilder();
      childBuilder.definition.methods = childDef.methods;
      childDef.children.forEach((v, k) => childBuilder.definition.children.set(k, v));
      childBuilder.applyTo(childResource, context, integrationRoles);
    }
  }
}
