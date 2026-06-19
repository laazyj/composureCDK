import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import {
  InterfaceVpcEndpoint,
  type IConnectable,
  type InterfaceVpcEndpointProps,
  type ISecurityGroup,
  type IVpc,
  type SecurityGroup,
} from "aws-cdk-lib/aws-ec2";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createSecurityGroupBuilder } from "./security-group-builder.js";
import { INTERFACE_ENDPOINT_DEFAULTS } from "./interface-endpoint-defaults.js";
import type { InterfaceEndpointAlarmConfig } from "./interface-endpoint-alarm-config.js";
import { createInterfaceEndpointAlarms } from "./interface-endpoint-alarms.js";

/**
 * Configuration properties for the interface-endpoint builder.
 *
 * Lifts three CDK props off the props object:
 * - `vpc` — supplied via {@link IInterfaceEndpointBuilder.vpc | .vpc()} so it
 *   can accept a {@link Resolvable} for cross-component wiring.
 * - `securityGroups` — supplied via
 *   {@link IInterfaceEndpointBuilder.securityGroups | .securityGroups()} so
 *   each can be a {@link Resolvable} (typically a sibling
 *   `SecurityGroupBuilder`).
 * - `open` — always `false`; ingress is explicit (see the builder docs).
 */
export interface InterfaceEndpointBuilderProps extends Omit<
  InterfaceVpcEndpointProps,
  "vpc" | "securityGroups" | "open"
> {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds. Individual alarms can be customized or disabled. Set to
   * `false` to disable all alarms.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#PrivateLinkEndpoints
   */
  recommendedAlarms?: InterfaceEndpointAlarmConfig | false;
}

/**
 * The build output of an {@link IInterfaceEndpointBuilder}.
 *
 * `securityGroup` is present only in **managed mode** — i.e. when the caller
 * did *not* supply `.securityGroups(...)`, so the builder auto-created one. It
 * is exposed for cases where sibling builders need to reference the
 * auto-created SG directly. In **BYO mode** it is `undefined`: the caller
 * already holds refs to the security groups they passed in.
 */
export interface InterfaceEndpointBuilderResult {
  endpoint: InterfaceVpcEndpoint;
  securityGroup?: SecurityGroup;
  alarms: Record<string, Alarm>;
}

interface AccessSpec {
  readonly peer: Resolvable<IConnectable>;
  readonly description?: string;
}

/**
 * A fluent builder for a single VPC interface endpoint (AWS PrivateLink).
 *
 * Unlike raw CDK — where interface endpoints exist only as a post-build
 * `vpc.addInterfaceEndpoint(...)` call whose security group is never exposed —
 * this builder is a first-class {@link compose} component. It maps 1:1 to a
 * CDK `InterfaceVpcEndpoint` (one `service` per endpoint); group several into
 * one access policy by pointing them at the same security group.
 *
 * **Security group, two modes:**
 * - *BYO* — call {@link IInterfaceEndpointBuilder.securityGroups | .securityGroups([...])}
 *   with security groups you fully manage (typically sibling
 *   `SecurityGroupBuilder`s). Full ingress/egress/port control; the builder
 *   creates no SG and `securityGroup` is absent from the result.
 * - *Managed shortcut* — omit `.securityGroups()` and the builder auto-creates
 *   a closed SG, exposes it on the result, and for each peer you pass to
 *   {@link IInterfaceEndpointBuilder.allowDefaultPortFrom} it opens ingress on
 *   the managed SG **and** egress on the peer's SG — matching exactly what CDK's
 *   `connections.allowDefaultPortFrom(...)` does bidirectionally.
 *
 * The two are mutually exclusive — combining BYO `.securityGroups()` with
 * `.allowDefaultPortFrom()` throws, since the rule would have nowhere it
 * could be applied that the caller isn't already managing.
 *
 * @see https://docs.aws.amazon.com/vpc/latest/privatelink/
 *
 * @example Managed shortcut (the SSM-from-bastion common case)
 * ```ts
 * createInterfaceEndpointBuilder()
 *   .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *   .service(InterfaceVpcEndpointAwsService.SSM)
 *   .subnets({ subnetType: SubnetType.PRIVATE_ISOLATED })
 *   .allowDefaultPortFrom(ref<SecurityGroupBuilderResult>("bastionSg").get("securityGroup"));
 * // result = { endpoint, securityGroup }
 * ```
 */
export type IInterfaceEndpointBuilder = ITaggedBuilder<
  InterfaceEndpointBuilderProps,
  InterfaceEndpointBuilder
>;

class InterfaceEndpointBuilder implements Lifecycle<InterfaceEndpointBuilderResult> {
  props: Partial<InterfaceEndpointBuilderProps> = {};
  readonly #access: AccessSpec[] = [];
  readonly #customAlarms: AlarmDefinitionBuilder<InterfaceVpcEndpoint>[] = [];
  #vpc?: Resolvable<IVpc>;
  #securityGroups?: Resolvable<ISecurityGroup>[];

  /**
   * Sets the VPC the endpoint is created in. Accepts a concrete {@link IVpc}
   * or a {@link Ref} to a sibling {@link IVpcBuilder}.
   */
  vpc(vpc: Resolvable<IVpc>): this {
    this.#vpc = vpc;
    return this;
  }

  /**
   * Bring-your-own security groups. Each entry is a {@link Resolvable}, so it
   * can be a concrete {@link ISecurityGroup} or a {@link Ref} to a sibling
   * `SecurityGroupBuilder` — giving you full ingress/egress/port control. When
   * set, the builder creates no security group of its own and
   * {@link InterfaceEndpointBuilderResult.securityGroup} is `undefined`.
   *
   * Mutually exclusive with {@link allowDefaultPortFrom}.
   */
  securityGroups(securityGroups: Resolvable<ISecurityGroup>[]): this {
    this.#securityGroups = securityGroups;
    return this;
  }

  /**
   * Managed-SG shortcut: wires `peer` to the auto-created security group via
   * CDK's `endpoint.connections.allowDefaultPortFrom(peer)` — opening ingress
   * on the managed SG from `peer`'s SG **and** egress from `peer`'s SG to the
   * managed SG, on the service's default port (443 for AWS services).
   *
   * Because this delegates to CDK connections, `peer` must be an
   * {@link IConnectable} (e.g. a `SecurityGroup` or `Instance`), not a raw
   * `IPeer` (e.g. `Peer.ipv4(...)`). For CIDR-based rules use BYO mode with
   * an explicit `addIngressRule` on your own {@link SecurityGroupBuilder}.
   *
   * Mutually exclusive with {@link securityGroups}.
   */
  allowDefaultPortFrom(peer: Resolvable<IConnectable>, description?: string): this {
    this.#access.push({ peer, description });
    return this;
  }

  /**
   * Adds a custom CloudWatch alarm alongside the recommended ones. The
   * callback receives an {@link AlarmDefinitionBuilder} typed to the
   * `InterfaceVpcEndpoint` construct, giving access to the endpoint at
   * build time for metric dimension wiring.
   */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<InterfaceVpcEndpoint>,
    ) => AlarmDefinitionBuilder<InterfaceVpcEndpoint>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<InterfaceVpcEndpoint>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: InterfaceEndpointBuilder): void {
    target.#vpc = this.#vpc;
    target.#securityGroups = this.#securityGroups ? [...this.#securityGroups] : undefined;
    target.#access.push(...this.#access);
    target.#customAlarms.push(...this.#customAlarms);
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

    const { recommendedAlarms: alarmConfig, service, ...endpointProps } = this.props;
    if (service === undefined) {
      throw new Error(
        `InterfaceEndpointBuilder "${id}" requires a service. ` +
          "Call .service() with an InterfaceVpcEndpointAwsService or a custom IInterfaceVpcEndpointService.",
      );
    }

    const byo = this.#securityGroups;
    if (byo !== undefined && this.#access.length > 0) {
      throw new Error(
        `InterfaceEndpointBuilder "${id}": .allowDefaultPortFrom() applies only to the ` +
          "auto-created security group and cannot be combined with .securityGroups() — " +
          "add the ingress rule to your own SecurityGroupBuilder instead.",
      );
    }

    let managedSecurityGroup: SecurityGroup | undefined;
    let securityGroups: ISecurityGroup[];
    if (byo !== undefined) {
      securityGroups = byo.map((sg) => resolve(sg, context));
    } else {
      managedSecurityGroup = createSecurityGroupBuilder()
        .vpc(resolvedVpc)
        .description(`Interface endpoint ${id}`)
        .build(scope, `${id}Sg`).securityGroup;
      securityGroups = [managedSecurityGroup];
    }

    const endpoint = new InterfaceVpcEndpoint(scope, id, {
      ...INTERFACE_ENDPOINT_DEFAULTS,
      ...endpointProps,
      service,
      vpc: resolvedVpc,
      securityGroups,
      // Always explicit: `open: true` would silently add a VPC-wide :443 rule.
      open: false,
    });

    for (const rule of this.#access) {
      endpoint.connections.allowDefaultPortFrom(resolve(rule.peer, context), rule.description);
    }

    const alarms = createInterfaceEndpointAlarms(
      scope,
      id,
      endpoint,
      alarmConfig,
      this.#customAlarms,
    );

    return { endpoint, securityGroup: managedSecurityGroup, alarms };
  }
}

/**
 * Creates a new {@link IInterfaceEndpointBuilder} for a single VPC interface
 * endpoint. The returned builder exposes every
 * {@link InterfaceEndpointBuilderProps} property as a fluent setter/getter,
 * plus `.vpc()`, `.securityGroups()` (BYO), and `.allowDefaultPortFrom()`
 * (managed-SG shortcut).
 */
export function createInterfaceEndpointBuilder(): IInterfaceEndpointBuilder {
  return taggedBuilder<InterfaceEndpointBuilderProps, InterfaceEndpointBuilder>(
    InterfaceEndpointBuilder,
  );
}
