import {
  InterfaceVpcEndpoint,
  type InterfaceVpcEndpointProps,
  type IInterfaceVpcEndpointService,
  type IPeer,
  type IVpc,
  Port,
  type SecurityGroup,
} from "aws-cdk-lib/aws-ec2";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { createSecurityGroupBuilder, type ISecurityGroupBuilder } from "./security-group-builder.js";
import { INTERFACE_ENDPOINT_DEFAULTS } from "./interface-endpoint-defaults.js";

/**
 * Configuration properties for the interface-endpoint builder.
 *
 * Lifts three CDK props off the props object:
 * - `vpc` — supplied via {@link IInterfaceEndpointBuilder.vpc | .vpc()} so it
 *   can accept a {@link Resolvable} for cross-component wiring.
 * - `securityGroups` / `open` — the builder *owns* the endpoint's security
 *   group so it can expose it on the result and let peers `ref` it. Ingress is
 *   declared with {@link IInterfaceEndpointBuilder.allowDefaultPortFrom}.
 */
export type InterfaceEndpointBuilderProps = Omit<
  InterfaceVpcEndpointProps,
  "vpc" | "securityGroups" | "open"
>;

/**
 * The build output of an {@link IInterfaceEndpointBuilder}.
 *
 * Both the endpoint *and* its owned security group are exposed so sibling
 * components can `ref` either side of the access edge — the peer's egress
 * rule references {@link InterfaceEndpointBuilderResult.securityGroup}, and
 * the endpoint's own ingress is opened via `.allowDefaultPortFrom(peer)`.
 */
export interface InterfaceEndpointBuilderResult {
  endpoint: InterfaceVpcEndpoint;
  securityGroup: SecurityGroup;
}

interface AccessSpec {
  readonly peer: Resolvable<IPeer>;
  readonly description?: string;
}

/**
 * A fluent builder for a single VPC interface endpoint (AWS PrivateLink).
 *
 * Unlike raw CDK — where interface endpoints exist only as a post-build
 * `vpc.addInterfaceEndpoint(...)` call whose security group is never exposed —
 * this builder is a first-class {@link compose} component. It owns the
 * endpoint's security group and returns it on the result so the access edge
 * is wired declaratively inside the `compose(...)` graph.
 *
 * @see https://docs.aws.amazon.com/vpc/latest/privatelink/
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     network: createVpcBuilder().natGateways(0),
 *     bastionSg: createSecurityGroupBuilder()
 *       .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *       .description("Bastion"),
 *     ssm: createInterfaceEndpointBuilder()
 *       .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *       .service(InterfaceVpcEndpointAwsService.SSM)
 *       .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
 *       .allowDefaultPortFrom(
 *         ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup"),
 *       ),
 *   },
 *   { network: [], bastionSg: ["network"], ssm: ["network", "bastionSg"] },
 * );
 * // result.ssm = { endpoint: InterfaceVpcEndpoint, securityGroup: SecurityGroup }
 * ```
 */
export type IInterfaceEndpointBuilder = ITaggedBuilder<
  InterfaceEndpointBuilderProps,
  InterfaceEndpointBuilder
>;

class InterfaceEndpointBuilder implements Lifecycle<InterfaceEndpointBuilderResult> {
  props: Partial<InterfaceEndpointBuilderProps> = {};
  readonly #access: AccessSpec[] = [];
  #vpc?: Resolvable<IVpc>;
  #configureSg?: (b: ISecurityGroupBuilder) => ISecurityGroupBuilder;

  /**
   * Sets the VPC the endpoint is created in. Accepts a concrete {@link IVpc}
   * or a {@link Ref} to a sibling {@link IVpcBuilder}.
   */
  vpc(vpc: Resolvable<IVpc>): this {
    this.#vpc = vpc;
    return this;
  }

  /**
   * Opens ingress on the endpoint's owned security group from `peer` on the
   * endpoint's default port (443). Mirrors CDK's
   * `endpoint.connections.allowDefaultPortFrom(...)` and the SG builder's
   * `addIngressRule`. The peer can be a concrete {@link IPeer} or a
   * {@link Ref} to a sibling component's security group.
   */
  allowDefaultPortFrom(peer: Resolvable<IPeer>, description?: string): this {
    this.#access.push({ peer, ...(description !== undefined ? { description } : {}) });
    return this;
  }

  /**
   * Escape hatch to customize the owned security group's sub-builder (name,
   * extra rules, description). The builder seeds it with the VPC and a
   * default description; the callback can refine it.
   */
  configureSecurityGroup(configure: (b: ISecurityGroupBuilder) => ISecurityGroupBuilder): this {
    this.#configureSg = configure;
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: InterfaceEndpointBuilder): void {
    target.#vpc = this.#vpc;
    target.#configureSg = this.#configureSg;
    target.#access.push(...this.#access);
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): InterfaceEndpointBuilderResult {
    const resolvedVpc = this.#vpc ? resolve(this.#vpc, context) : undefined;
    if (!resolvedVpc) {
      throw new Error(
        `InterfaceEndpointBuilder "${id}" requires a VPC. Call .vpc() with an IVpc or a Ref to one.`,
      );
    }
    if (this.props.service === undefined) {
      throw new Error(
        `InterfaceEndpointBuilder "${id}" requires a service. ` +
          "Call .service() with an InterfaceVpcEndpointAwsService or a custom IInterfaceVpcEndpointService.",
      );
    }

    const securityGroup = buildOwnedSecurityGroup(
      scope,
      `${id}Sg`,
      resolvedVpc,
      `Interface endpoint ${id}`,
      this.#configureSg,
    );
    for (const rule of this.#access) {
      securityGroup.addIngressRule(resolve(rule.peer, context), Port.tcp(443), rule.description);
    }

    const endpoint = new InterfaceVpcEndpoint(scope, id, {
      ...INTERFACE_ENDPOINT_DEFAULTS,
      ...this.props,
      service: this.props.service as IInterfaceVpcEndpointService,
      vpc: resolvedVpc,
      securityGroups: [securityGroup],
      open: false,
    });

    return { endpoint, securityGroup };
  }
}

/** @internal Shared SG-ownership helper for the single + bundle endpoint builders. */
export function buildOwnedSecurityGroup(
  scope: IConstruct,
  id: string,
  vpc: IVpc,
  defaultDescription: string,
  configure?: (b: ISecurityGroupBuilder) => ISecurityGroupBuilder,
): SecurityGroup {
  let sg = createSecurityGroupBuilder().vpc(vpc).description(defaultDescription);
  if (configure) {
    sg = configure(sg);
  }
  return sg.build(scope, id).securityGroup;
}

/**
 * Creates a new {@link IInterfaceEndpointBuilder} for a single VPC interface
 * endpoint. The returned builder exposes every
 * {@link InterfaceEndpointBuilderProps} property as a fluent setter/getter,
 * plus `.vpc()`, `.allowDefaultPortFrom()`, and `.configureSecurityGroup()`.
 */
export function createInterfaceEndpointBuilder(): IInterfaceEndpointBuilder {
  return taggedBuilder<InterfaceEndpointBuilderProps, InterfaceEndpointBuilder>(
    InterfaceEndpointBuilder,
  );
}
