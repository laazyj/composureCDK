import {
  CrossAccountZoneDelegationRecord,
  type CrossAccountZoneDelegationRecordProps,
  type IHostedZone,
} from "aws-cdk-lib/aws-route53";
import { Role, type IRole } from "aws-cdk-lib/aws-iam";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { CROSS_ACCOUNT_ZONE_DELEGATION_DEFAULTS } from "./defaults.js";
import {
  applyDelegationProviderLogging,
  type DelegationProviderLoggingConfig,
} from "./cross-account-delegation-provider-logging.js";

/**
 * Configuration properties for the Route 53 cross-account zone delegation
 * record builder.
 *
 * Extends the CDK {@link CrossAccountZoneDelegationRecordProps} but replaces
 * `delegatedZone` and `delegationRole` with {@link Resolvable}s so they can be
 * wired from composed components, and adds {@link providerLogging} for the
 * custom-resource provider's log group.
 */
export interface CrossAccountZoneDelegationBuilderProps extends Omit<
  CrossAccountZoneDelegationRecordProps,
  "delegatedZone" | "delegationRole"
> {
  /**
   * The hosted zone this account owns, whose name servers are published into
   * the parent zone. Must be a public hosted zone created in this stack:
   * private zones have no name servers, and a zone imported via
   * `fromHostedZoneAttributes`/`fromLookup` (or referenced across stacks) does
   * not carry the `hostedZoneNameServers` attribute the record needs. The
   * builder fails at build time on any of those rather than synthesising a
   * delegation with an empty NS set.
   */
  delegatedZone?: Resolvable<IHostedZone>;

  /**
   * The role in the **parent** account that this stack assumes to write the
   * `NS` records — the role granted by
   * `hostedZoneGrants.delegation(parentZone, { delegatedZoneNames: [...] })`.
   *
   * Accepts a plain role ARN, which the builder imports for you. In the case
   * this builder exists for, the role lives in another account and this stack
   * has nothing to `ref` — only an ARN — so passing the ARN removes the
   * `Role.fromRoleArn(...)` line every call site would otherwise repeat. An
   * `IRole` (or a `Ref` to either) covers the same-account and same-app cases.
   */
  delegationRole?: Resolvable<string | IRole>;

  /**
   * See {@link DelegationProviderLoggingConfig}. Defaults to an auto-managed
   * CloudWatch log group for the stack's shared delegation-provider Lambda,
   * carrying the `@composurecdk/logs` retention and removal defaults. Set to
   * `false` to leave the provider's logging to the Lambda service.
   */
  providerLogging?: DelegationProviderLoggingConfig;
}

/**
 * The build output of an {@link ICrossAccountZoneDelegationBuilder}. Contains
 * the CDK constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface CrossAccountZoneDelegationBuilderResult {
  /** The Route 53 cross-account delegation record construct created by the builder. */
  record: CrossAccountZoneDelegationRecord;

  /**
   * The role assumed in the parent account to write the `NS` records — the
   * `IRole` that was passed in, or the one the builder imported from the ARN.
   */
  delegationRole: IRole;

  /**
   * The CloudWatch log group the stack's delegation-provider Lambda logs to,
   * or `undefined` when no record in this stack has enabled provider logging,
   * or the provider could not be located.
   *
   * The custom-resource provider is a **stack-level singleton**, so this log
   * group is shared by every delegation record in the stack — the same handle
   * is returned to each, including to a record that set
   * `providerLogging(false)` after a sibling had already created it (that
   * record warns and logs there anyway). Wire subscription or metric filters
   * onto it by all means; treat mutations as stack-wide.
   */
  providerLogGroup?: LogGroup;
}

/**
 * A fluent builder for configuring and creating a Route 53
 * {@link CrossAccountZoneDelegationRecord} — the child account's half of a
 * cross-account subdomain delegation.
 *
 * Each configuration property from the CDK
 * {@link CrossAccountZoneDelegationRecordProps} is exposed as an overloaded
 * method: call with a value to set it (returns the builder for chaining), or
 * call with no arguments to read the current value.
 *
 * The record publishes the delegated zone's own name servers into a parent
 * hosted zone owned by another account, via a Lambda-backed custom resource
 * that assumes {@link CrossAccountZoneDelegationBuilderProps.delegationRole}.
 * The parent account's half — the role itself — is declared with
 * `hostedZoneGrants.delegation(...)`.
 *
 * @example
 * ```ts
 * const delegation = createCrossAccountZoneDelegationBuilder()
 *   .delegatedZone(ref("childZone", (r: HostedZoneBuilderResult) => r.hostedZone))
 *   .parentHostedZoneName("example.com")
 *   .delegationRole("arn:aws:iam::111122223333:role/delegation-beta");
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::CloudFormation::CustomResource has no Tags property
export type ICrossAccountZoneDelegationBuilder = IBuilder<
  CrossAccountZoneDelegationBuilderProps,
  CrossAccountZoneDelegationBuilder
>;

class CrossAccountZoneDelegationBuilder implements Lifecycle<CrossAccountZoneDelegationBuilderResult> {
  props: Partial<CrossAccountZoneDelegationBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): CrossAccountZoneDelegationBuilderResult {
    const { delegatedZone, delegationRole, providerLogging, ...rest } = {
      ...CROSS_ACCOUNT_ZONE_DELEGATION_DEFAULTS,
      ...this.props,
    };

    if (!delegatedZone) {
      throw new Error(
        `CrossAccountZoneDelegationBuilder "${id}" requires a delegatedZone. ` +
          `Call .delegatedZone() with the public hosted zone this account owns.`,
      );
    }
    if (!delegationRole) {
      throw new Error(
        `CrossAccountZoneDelegationBuilder "${id}" requires a delegationRole. ` +
          `Call .delegationRole() with the ARN of the role the parent account granted ` +
          `via hostedZoneGrants.delegation(), or with an IRole.`,
      );
    }

    const { parentHostedZoneName, parentHostedZoneId } = rest;
    if (parentHostedZoneName && parentHostedZoneId) {
      throw new Error(
        `CrossAccountZoneDelegationBuilder "${id}": .parentHostedZoneName() and ` +
          `.parentHostedZoneId() are mutually exclusive. Set exactly one — the id when the ` +
          `parent account holds several zones of the same name, the name otherwise.`,
      );
    }
    if (!parentHostedZoneName && !parentHostedZoneId) {
      throw new Error(
        `CrossAccountZoneDelegationBuilder "${id}" requires the parent zone. ` +
          `Call .parentHostedZoneName() with the parent domain, or .parentHostedZoneId() when ` +
          `the parent account holds several zones of the same name. They are mutually ` +
          `exclusive — set exactly one.`,
      );
    }

    const zone = resolve(delegatedZone, context);
    // The construct feeds `zone.hostedZoneNameServers` straight to the custom
    // resource. Private zones have none, and imported/cross-stack zones do not
    // carry the attribute — both would deploy a delegation with an empty NS
    // set, resolving nothing, with no error from CloudFormation.
    if (zone.hostedZoneNameServers === undefined) {
      throw new Error(
        `CrossAccountZoneDelegationBuilder "${id}": the delegated zone "${zone.zoneName}" ` +
          `exposes no name servers, so the delegation would be written with an empty NS record ` +
          `set and the subdomain would resolve nowhere. Private hosted zones have no name ` +
          `servers at all, and a zone imported with fromHostedZoneAttributes/fromLookup or ` +
          `referenced from another stack does not carry the attribute. Pass a public hosted ` +
          `zone created in this stack — e.g. createHostedZoneBuilder()'s hostedZone, wired ` +
          `with ref().`,
      );
    }

    const resolvedRole = resolve(delegationRole, context);
    const role =
      typeof resolvedRole === "string"
        ? // Immutable by design: the role belongs to the parent account, and
          // this stack only assumes it — it must never try to attach policies.
          Role.fromRoleArn(scope, `${id}DelegationRole`, resolvedRole, { mutable: false })
        : resolvedRole;

    const record = new CrossAccountZoneDelegationRecord(scope, id, {
      ...rest,
      delegatedZone: zone,
      delegationRole: role,
    });

    // After the record: constructing it is what materialises the provider.
    const providerLogGroup = applyDelegationProviderLogging(scope, providerLogging, context);

    return { record, delegationRole: role, providerLogGroup };
  }
}

/**
 * Creates a new {@link ICrossAccountZoneDelegationBuilder} for configuring a
 * Route 53 cross-account zone delegation record.
 *
 * This is the child account's half of a cross-account subdomain delegation:
 * it publishes the delegated zone's `NS` records into a parent hosted zone in
 * another account, using a role that account granted with
 * `hostedZoneGrants.delegation(...)`.
 *
 * @returns A fluent builder for a Route 53 cross-account zone delegation record.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     childZone: createHostedZoneBuilder().zoneName("beta.example.com"),
 *
 *     parentDelegation: createCrossAccountZoneDelegationBuilder()
 *       .delegatedZone(ref("childZone", (r: HostedZoneBuilderResult) => r.hostedZone))
 *       .parentHostedZoneName("example.com")
 *       .delegationRole("arn:aws:iam::111122223333:role/delegation-beta")
 *       .ttl(Duration.minutes(30)),
 *   },
 *   { childZone: [], parentDelegation: ["childZone"] },
 * );
 * ```
 */
export function createCrossAccountZoneDelegationBuilder(): ICrossAccountZoneDelegationBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::CloudFormation::CustomResource has no Tags property
  return Builder<CrossAccountZoneDelegationBuilderProps, CrossAccountZoneDelegationBuilder>(
    CrossAccountZoneDelegationBuilder,
  );
}
