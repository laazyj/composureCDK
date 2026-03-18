import { type Integration, type IResource, type MethodOptions } from "aws-cdk-lib/aws-apigateway";

interface MethodDefinition {
  httpMethod: string;
  integration?: Integration;
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
   * @param integration - The backend integration for this method.
   * @param options - Additional method configuration such as authorization or method responses.
   * @returns This builder for chaining.
   */
  addMethod(httpMethod: string, integration?: Integration, options?: MethodOptions): this {
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

  /** @internal */
  applyTo(resource: IResource): void {
    for (const method of this.definition.methods) {
      resource.addMethod(method.httpMethod, method.integration, method.options);
    }
    for (const [pathPart, childDef] of this.definition.children) {
      const childResource = resource.addResource(pathPart);
      const childBuilder = new ResourceBuilder();
      childBuilder.definition.methods = childDef.methods;
      childDef.children.forEach((v, k) => childBuilder.definition.children.set(k, v));
      childBuilder.applyTo(childResource);
    }
  }
}
