import {
  InterfaceVpcEndpoint,
  InterfaceVpcEndpointAwsService,
  type IInterfaceVpcEndpointService,
  type IPeer,
  type IVpc,
  Port,
  type SecurityGroup,
  type SubnetSelection,
} from "aws-cdk-lib/aws-ec2";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { type ISecurityGroupBuilder } from "./security-group-builder.js";
import { buildOwnedSecurityGroup } from "./interface-endpoint-builder.js";
import { INTERFACE_ENDPOINT_DEFAULTS } from "./interface-endpoint-defaults.js";

/**
 * The three interface endpoints required for AWS Systems Manager / Session
 * Manager reachability in a NAT-free, isolated VPC. All three share identical
 * `:443`-from-peer ingress, so the bundle builder gives them one shared SG.
 *
 * @see https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html
 */
export const SSM_ACCESS_SERVICES: readonly IInterfaceVpcEndpointService[] = [
  InterfaceVpcEndpointAwsService.SSM,
  InterfaceVpcEndpointAwsService.SSM_MESSAGES,
  InterfaceVpcEndpointAwsService.EC2_MESSAGES,
];

/**
 * Configuration shared across every endpoint in the bundle. Per-service
 * settings (the service identity itself) are added via `.services()` /
 * `.ssmAccess()`; the access edge via `.allowDefaultPortFrom()`.
 */
export interface InterfaceEndpointsBuilderProps {
  /** Subnets to place every endpoint's ENIs in. */
  subnets?: SubnetSelection;
  /** Private DNS toggle applied to every endpoint. Defaults to `true`. */
  privateDnsEnabled?: boolean;
}

/**
 * The build output of an {@link IInterfaceEndpointsBuilder}. The endpoints are
 * keyed by service short name (e.g. `"ssm"`, `"ssmmessages"`, `"ec2messages"`);
 * the single shared {@link InterfaceEndpointsBuilderResult.securityGroup} is
 * `ref`-able by peers for their egress side.
 */
export interface InterfaceEndpointsBuilderResult {
  endpoints: Record<string, InterfaceVpcEndpoint>;
  securityGroup: SecurityGroup;
}

interface AccessSpec {
  readonly peer: Resolvable<IPeer>;
  readonly description?: string;
}

/**
 * A fluent builder for a *bundle* of interface endpoints that share one
 * security group — the composable form of "add the three SSM endpoints to my
 * isolated VPC". One component, one `ref` target, one access edge.
 *
 * @example
 * ```ts
 * ssmAccess: createInterfaceEndpointsBuilder()
 *   .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *   .ssmAccess()
 *   .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
 *   .allowDefaultPortFrom(
 *     ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup"),
 *   ),
 * // result.ssmAccess = { endpoints: { ssm, ssmmessages, ec2messages }, securityGroup }
 * ```
 */
export type IInterfaceEndpointsBuilder = ITaggedBuilder<
  InterfaceEndpointsBuilderProps,
  InterfaceEndpointsBuilder
>;

class InterfaceEndpointsBuilder implements Lifecycle<InterfaceEndpointsBuilderResult> {
  props: Partial<InterfaceEndpointsBuilderProps> = {};
  readonly #services: IInterfaceVpcEndpointService[] = [];
  readonly #access: AccessSpec[] = [];
  #vpc?: Resolvable<IVpc>;
  #configureSg?: (b: ISecurityGroupBuilder) => ISecurityGroupBuilder;

  /** Sets the VPC. Accepts a concrete {@link IVpc} or a {@link Ref}. */
  vpc(vpc: Resolvable<IVpc>): this {
    this.#vpc = vpc;
    return this;
  }

  /** Adds the services to emit endpoints for. Additive across calls. */
  services(services: readonly IInterfaceVpcEndpointService[]): this {
    this.#services.push(...services);
    return this;
  }

  /** Convenience: adds the {@link SSM_ACCESS_SERVICES} bundle. */
  ssmAccess(): this {
    return this.services(SSM_ACCESS_SERVICES);
  }

  /** Opens `:443` ingress on the shared SG from `peer`. See the single-endpoint builder. */
  allowDefaultPortFrom(peer: Resolvable<IPeer>, description?: string): this {
    this.#access.push({ peer, ...(description !== undefined ? { description } : {}) });
    return this;
  }

  /** Escape hatch to customize the shared security group's sub-builder. */
  configureSecurityGroup(configure: (b: ISecurityGroupBuilder) => ISecurityGroupBuilder): this {
    this.#configureSg = configure;
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: InterfaceEndpointsBuilder): void {
    target.#vpc = this.#vpc;
    target.#configureSg = this.#configureSg;
    target.#services.push(...this.#services);
    target.#access.push(...this.#access);
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): InterfaceEndpointsBuilderResult {
    const resolvedVpc = this.#vpc ? resolve(this.#vpc, context) : undefined;
    if (!resolvedVpc) {
      throw new Error(
        `InterfaceEndpointsBuilder "${id}" requires a VPC. Call .vpc() with an IVpc or a Ref to one.`,
      );
    }
    if (this.#services.length === 0) {
      throw new Error(
        `InterfaceEndpointsBuilder "${id}" has no services. Call .services([...]) or .ssmAccess().`,
      );
    }

    const securityGroup = buildOwnedSecurityGroup(
      scope,
      `${id}Sg`,
      resolvedVpc,
      `Interface endpoints ${id}`,
      this.#configureSg,
    );
    for (const rule of this.#access) {
      securityGroup.addIngressRule(resolve(rule.peer, context), Port.tcp(443), rule.description);
    }

    const endpoints: Record<string, InterfaceVpcEndpoint> = {};
    for (const service of this.#services) {
      const key = service.shortName;
      endpoints[key] = new InterfaceVpcEndpoint(scope, `${id}-${key}`, {
        ...INTERFACE_ENDPOINT_DEFAULTS,
        ...this.props,
        service,
        vpc: resolvedVpc,
        securityGroups: [securityGroup],
        open: false,
      });
    }

    return { endpoints, securityGroup };
  }
}

/**
 * Creates a new {@link IInterfaceEndpointsBuilder} for a bundle of interface
 * endpoints sharing one security group.
 */
export function createInterfaceEndpointsBuilder(): IInterfaceEndpointsBuilder {
  return taggedBuilder<InterfaceEndpointsBuilderProps, InterfaceEndpointsBuilder>(
    InterfaceEndpointsBuilder,
  );
}
