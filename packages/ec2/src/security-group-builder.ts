import {
  type IPeer,
  type IVpc,
  type Port,
  SecurityGroup,
  type SecurityGroupProps,
} from "aws-cdk-lib/aws-ec2";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { SECURITY_GROUP_DEFAULTS } from "./security-group-defaults.js";
import {
  validateSecurityGroupDescription,
  validateSecurityGroupName,
} from "./security-group-constraints.js";

/**
 * Configuration properties for the security group builder.
 *
 * Extends the CDK {@link SecurityGroupProps} but lifts `vpc` off the props
 * object — it is supplied via the dedicated
 * {@link ISecurityGroupBuilder.vpc | .vpc()} method so it can accept a
 * {@link Resolvable} for cross-component wiring (e.g. a sibling
 * `VpcBuilder`).
 *
 * Ingress and egress rules are added imperatively via
 * {@link ISecurityGroupBuilder.addIngressRule | .addIngressRule()},
 * {@link ISecurityGroupBuilder.addEgressRule | .addEgressRule()}, and
 * {@link ISecurityGroupBuilder.addSelfIngress | .addSelfIngress()} so each
 * peer can also be a {@link Resolvable}.
 */
export type SecurityGroupBuilderProps = Omit<SecurityGroupProps, "vpc">;

/**
 * The build output of an {@link ISecurityGroupBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 *
 * The `securityGroup` is itself an `IConnectable` and `IPeer`, so consumers
 * compose against it directly — there is no separate `connections` field on
 * the result.
 *
 * The builder creates no CloudWatch alarms. Security groups do not emit
 * CloudWatch metrics, so the
 * [recommended-alarms reference](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html)
 * has no SG entry. Operational visibility comes from adjacent signals —
 * VPC Flow Logs, GuardDuty findings, CloudTrail authorize-events.
 */
export interface SecurityGroupBuilderResult {
  securityGroup: SecurityGroup;
}

interface PeerRuleSpec {
  readonly direction: "ingress" | "egress";
  readonly peer: Resolvable<IPeer>;
  readonly port: Port;
  readonly description?: string;
}

interface SelfIngressSpec {
  readonly port: Port;
  readonly description?: string;
}

/**
 * A fluent builder for configuring and creating an AWS EC2 security group.
 *
 * Each configuration property from the CDK {@link SecurityGroupProps} (other
 * than `vpc`) is exposed as an overloaded method: call with a value to set
 * it, or with no arguments to read it. The `vpc` is set via the dedicated
 * {@link ISecurityGroupBuilder.vpc | .vpc()} method that accepts a
 * {@link Resolvable} for cross-component wiring with sibling builders.
 *
 * Ingress and egress rules are accumulated via
 * {@link ISecurityGroupBuilder.addIngressRule | .addIngressRule()},
 * {@link ISecurityGroupBuilder.addEgressRule | .addEgressRule()}, and
 * {@link ISecurityGroupBuilder.addSelfIngress | .addSelfIngress()} and
 * applied when {@link Lifecycle.build | build()} runs. Each peer is a
 * {@link Resolvable} so it can be a concrete `IPeer` (including another
 * `ISecurityGroup`) or a {@link ref | Ref} to a sibling component's output.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.SecurityGroup.html
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     network: createVpcBuilder(),
 *     bastion: createSecurityGroupBuilder()
 *       .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *       .description("Bastion host"),
 *     database: createSecurityGroupBuilder()
 *       .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *       .description("Database")
 *       .addIngressRule(
 *         ref<SecurityGroupBuilderResult>("bastion").get("securityGroup"),
 *         Port.tcp(5432),
 *         "Bastion to Postgres",
 *       ),
 *   },
 *   { network: [], bastion: ["network"], database: ["network", "bastion"] },
 * );
 * ```
 */
export type ISecurityGroupBuilder = ITaggedBuilder<SecurityGroupBuilderProps, SecurityGroupBuilder>;

class SecurityGroupBuilder implements Lifecycle<SecurityGroupBuilderResult> {
  props: Partial<SecurityGroupBuilderProps> = {};
  readonly #peerRules: PeerRuleSpec[] = [];
  readonly #selfIngress: SelfIngressSpec[] = [];
  #vpc?: Resolvable<IVpc>;

  /**
   * Sets the VPC the security group is created in.
   *
   * Accepts a concrete {@link IVpc} or a {@link Ref} that resolves to one
   * at build time — e.g. a sibling {@link IVpcBuilder} in the same
   * composed system.
   *
   * @param vpc - The VPC or a Ref to one.
   * @returns This builder for chaining.
   */
  vpc(vpc: Resolvable<IVpc>): this {
    this.#vpc = vpc;
    return this;
  }

  /**
   * Adds an ingress rule. The peer accepts any {@link IPeer} — a concrete
   * `Peer.ipv4(...)`, another `ISecurityGroup`, a prefix list — or a
   * {@link Ref} that resolves to one.
   *
   * @param peer - The source of the allowed traffic.
   * @param port - The port or port range.
   * @param description - Optional human-readable description of the rule.
   * @returns This builder for chaining.
   */
  addIngressRule(peer: Resolvable<IPeer>, port: Port, description?: string): this {
    this.#peerRules.push({
      direction: "ingress",
      peer,
      port,
      ...(description !== undefined ? { description } : {}),
    });
    return this;
  }

  /**
   * Adds an egress rule. Required when `allowAllOutbound` is `false`
   * (the builder default — see {@link SECURITY_GROUP_DEFAULTS}). The peer
   * accepts any {@link IPeer} or a {@link Ref} that resolves to one.
   *
   * @param peer - The destination of the allowed traffic.
   * @param port - The port or port range.
   * @param description - Optional human-readable description of the rule.
   * @returns This builder for chaining.
   */
  addEgressRule(peer: Resolvable<IPeer>, port: Port, description?: string): this {
    this.#peerRules.push({
      direction: "egress",
      peer,
      port,
      ...(description !== undefined ? { description } : {}),
    });
    return this;
  }

  /**
   * Adds an ingress rule whose peer is the security group itself —
   * the canonical "allow intra-SG traffic on port N" pattern. The peer
   * cannot be expressed at configuration time because the security group
   * identity does not exist yet; the builder wires it after the SG is
   * constructed.
   *
   * @param port - The port or port range.
   * @param description - Optional human-readable description of the rule.
   * @returns This builder for chaining.
   */
  addSelfIngress(port: Port, description?: string): this {
    this.#selfIngress.push({
      port,
      ...(description !== undefined ? { description } : {}),
    });
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: SecurityGroupBuilder): void {
    target.#vpc = this.#vpc;
    target.#peerRules.push(...this.#peerRules);
    target.#selfIngress.push(...this.#selfIngress);
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): SecurityGroupBuilderResult {
    const resolvedVpc = this.#vpc ? resolve(this.#vpc, context) : undefined;
    if (!resolvedVpc) {
      throw new Error(
        `SecurityGroupBuilder "${id}" requires a VPC. ` +
          "Call .vpc() with an IVpc or a Ref to one.",
      );
    }
    if (this.props.description === undefined || this.props.description.trim() === "") {
      throw new Error(
        `SecurityGroupBuilder "${id}" requires a description. ` +
          "Call .description() with a short summary of the SG's purpose.",
      );
    }

    // Fail at synth, at the authoring call site, instead of CREATE_FAILED at
    // deploy time. The validators skip unresolved tokens (ADR-0010).
    validateSecurityGroupDescription(this.props.description);
    if (this.props.securityGroupName !== undefined) {
      validateSecurityGroupName(this.props.securityGroupName);
    }

    // Drop keys whose value is `undefined` so a fluent call like
    // `.allowAllOutbound(undefined)` (common in "optional override" code:
    // `b.allowAllOutbound(cfg?.allowAllOutbound)`) does not clobber the
    // closed-egress default with explicit `undefined`.
    const userProps: Partial<SecurityGroupBuilderProps> = {};
    for (const key of Object.keys(this.props) as (keyof SecurityGroupBuilderProps)[]) {
      const value = this.props[key];
      if (value !== undefined) {
        (userProps as Record<string, unknown>)[key] = value;
      }
    }

    const mergedProps = {
      ...SECURITY_GROUP_DEFAULTS,
      ...userProps,
      vpc: resolvedVpc,
    } as SecurityGroupProps;

    const securityGroup = new SecurityGroup(scope, id, mergedProps);

    for (const rule of this.#peerRules) {
      const peer = resolve(rule.peer, context);
      if (rule.direction === "ingress") {
        securityGroup.addIngressRule(peer, rule.port, rule.description);
      } else {
        securityGroup.addEgressRule(peer, rule.port, rule.description);
      }
    }
    for (const rule of this.#selfIngress) {
      securityGroup.addIngressRule(securityGroup, rule.port, rule.description);
    }

    return { securityGroup };
  }
}

/**
 * Creates a new {@link ISecurityGroupBuilder} for configuring an AWS EC2
 * security group.
 *
 * The returned builder exposes every {@link SecurityGroupBuilderProps}
 * property as a fluent setter/getter, plus
 * {@link ISecurityGroupBuilder.vpc | .vpc()} for cross-component VPC wiring
 * and the `addIngressRule` / `addEgressRule` / `addSelfIngress` accumulators.
 * It implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS EC2 security group.
 */
export function createSecurityGroupBuilder(): ISecurityGroupBuilder {
  return taggedBuilder<SecurityGroupBuilderProps, SecurityGroupBuilder>(SecurityGroupBuilder);
}
