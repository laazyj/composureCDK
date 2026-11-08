import { CfnPolicy } from "aws-cdk-lib/aws-organizations";
import { PolicyDocument, type PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, type Resolvable, resolve } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { isStatementBuilder, type StatementBuilder } from "@composurecdk/iam";
import { assertWithinSizeQuota, toServiceControlPolicyStatement } from "./policy-statements.js";
import { validatePolicyDescription, validatePolicyName } from "./policy-constraints.js";
import { type PolicyTarget, validatePolicyTargetId } from "./target.js";

/**
 * Configuration properties for the service control policy builder.
 */
export interface ServiceControlPolicyBuilderProps {
  /** The policy's name, shown in the Organizations console. Required. */
  name?: string;
  /** What the policy is for. */
  description?: string;
}

/**
 * The build output of an {@link IServiceControlPolicyBuilder}.
 */
export interface ServiceControlPolicyBuilderResult {
  /** The `AWS::Organizations::Policy` construct. */
  policy: CfnPolicy;
  /** The policy document, which is the policy's `Content`. */
  document: PolicyDocument;
}

/**
 * A fluent builder for an AWS Organizations service control policy (SCP).
 *
 * Wraps the {@link CfnPolicy} L1 construct — CDK ships no Organizations L2 —
 * with `Type` fixed to `SERVICE_CONTROL_POLICY`. Statements are IAM
 * statements, from `@composurecdk/iam`'s `createStatementBuilder()` or plain
 * CDK `PolicyStatement`s. `build()` checks at synth what AWS would otherwise
 * reject at deploy: a `Principal` in a statement, a document over
 * {@link SERVICE_CONTROL_POLICY_QUOTAS.maxCharacters}, malformed target IDs
 * and an empty policy. A policy with no targets throws unless
 * {@link detached} says that is intended.
 *
 * Deploy from the organization's management account, or a delegated
 * administrator for policy management, with the SCP policy type already
 * enabled on the root.
 *
 * @example
 * ```ts
 * createServiceControlPolicyBuilder()
 *   .name("DenyLeavingOrg")
 *   .addStatements([
 *     createStatementBuilder()
 *       .sid("DenyLeaveOrg")
 *       .deny()
 *       .actions(["organizations:LeaveOrganization"])
 *       .resources(["*"]),
 *   ])
 *   .attachTo([target.root("r-ab12")])
 *   .build(stack, "DenyLeavingOrg");
 * ```
 */
export type IServiceControlPolicyBuilder = ITaggedBuilder<
  ServiceControlPolicyBuilderProps,
  ServiceControlPolicyBuilder
>;

class ServiceControlPolicyBuilder implements Lifecycle<ServiceControlPolicyBuilderResult> {
  props: Partial<ServiceControlPolicyBuilderProps> = {};
  readonly #statements: (PolicyStatement | StatementBuilder)[] = [];
  readonly #exceptPrincipals: string[] = [];
  readonly #targets: Resolvable<PolicyTarget>[] = [];
  #detached = false;

  /**
   * Append statements to the policy. Statement builders are built during
   * {@link build}, so their wildcard-resource guard runs then.
   */
  addStatements(statements: (PolicyStatement | StatementBuilder)[]): this {
    this.#statements.push(...statements);
    return this;
  }

  /**
   * Exempt principals from every `Deny` statement in the policy, by adding
   * `ArnNotLike: { "aws:PrincipalArn": [...] }` to each. Use it for
   * break-glass and pipeline roles. `Allow` statements are left alone.
   *
   * @param arnPatterns - IAM ARN patterns; wildcards are allowed, e.g.
   *   `"arn:aws:iam::*:role/OrganizationAccountAccessRole"`.
   * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html
   */
  exceptPrincipals(arnPatterns: string[]): this {
    this.#exceptPrincipals.push(...arnPatterns);
    return this;
  }

  /**
   * Attach the policy to roots, OUs or accounts — the policy's `TargetIds`.
   * Build each target with {@link target}, or pass a `ref` to a sibling that
   * produces one. Repeated calls add to the list.
   */
  attachTo(targets: Resolvable<PolicyTarget>[]): this {
    this.#targets.push(...targets);
    return this;
  }

  /**
   * Create the policy without attaching it anywhere. Without this, a policy
   * with no targets fails the build: a detached SCP deploys and does nothing,
   * which is almost always a mistake.
   */
  detached(): this {
    this.#detached = true;
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ServiceControlPolicyBuilder): void {
    target.#statements.push(...this.#statements);
    target.#exceptPrincipals.push(...this.#exceptPrincipals);
    target.#targets.push(...this.#targets);
    target.#detached = this.#detached;
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): ServiceControlPolicyBuilderResult {
    const label = `ServiceControlPolicyBuilder "${id}"`;
    const { name, description } = this.props;

    if (name === undefined) throw new Error(`${label}: name(...) must be set.`);
    validatePolicyName(name);
    if (description !== undefined) validatePolicyDescription(description);

    if (this.#statements.length === 0) {
      throw new Error(`${label}: the policy has no statements. Add some with addStatements(...).`);
    }

    const targetIds = this.#targets.map((t) => resolve(t, context));
    targetIds.forEach(validatePolicyTargetId);
    if (this.#detached && targetIds.length > 0) {
      throw new Error(`${label}: detached() and attachTo(...) cannot both be set.`);
    }
    if (!this.#detached && targetIds.length === 0) {
      throw new Error(
        `${label}: the policy has no targets, so it would deploy and do nothing. ` +
          `Attach it with attachTo(...), or call detached() if that is intended.`,
      );
    }

    const document = new PolicyDocument({
      statements: this.#statements.map((s) =>
        toServiceControlPolicyStatement(
          isStatementBuilder(s) ? s.build() : s,
          this.#exceptPrincipals,
        ),
      ),
    });
    assertWithinSizeQuota(label, scope, document);

    const policy = new CfnPolicy(scope, id, {
      name,
      description,
      type: "SERVICE_CONTROL_POLICY",
      content: document,
      targetIds: targetIds.length > 0 ? targetIds : undefined,
    });

    return { policy, document };
  }
}

/**
 * Creates a new {@link IServiceControlPolicyBuilder} for an AWS
 * Organizations service control policy.
 */
export function createServiceControlPolicyBuilder(): IServiceControlPolicyBuilder {
  return taggedBuilder<ServiceControlPolicyBuilderProps, ServiceControlPolicyBuilder>(
    ServiceControlPolicyBuilder,
  );
}
