import {
  type IManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  type RoleProps,
} from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { ROLE_DEFAULTS } from "./role-defaults.js";
import { StatementBuilder } from "./statement-builder.js";

/**
 * Configuration properties for the IAM role builder.
 *
 * Extends the CDK {@link RoleProps} with builder-specific options for
 * cross-component wiring: `permissionsBoundary` accepts a {@link Resolvable}
 * so boundary policies built by sibling components can be referenced at
 * configuration time.
 */
interface RoleBuilderProps extends Omit<RoleProps, "permissionsBoundary"> {
  /**
   * A permissions boundary that caps the maximum permissions this role
   * can ever grant, regardless of inline or managed policies attached.
   *
   * Accepts a concrete {@link IManagedPolicy} or a {@link Resolvable} for
   * cross-component wiring (e.g. `ref("boundary", r => r.policy)`).
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html
   */
  permissionsBoundary?: Resolvable<IManagedPolicy>;
}

/**
 * The build output of an {@link IRoleBuilder}.
 *
 * Exposes every CDK construct the builder creates so consumers can reference,
 * extend, or attach additional policies to them.
 */
export interface RoleBuilderResult {
  /** The IAM role construct created by the builder. */
  role: Role;

  /**
   * Inline {@link PolicyDocument}s created for each
   * {@link IRoleBuilder.addInlinePolicyStatements} call, keyed by the
   * policy name supplied to the call.
   *
   * The documents are embedded in the underlying `AWS::IAM::Role`
   * resource via the native `Policies` array — no separate
   * `AWS::IAM::Policy` resources are created.
   *
   * Inline policies supplied directly via the native `inlinePolicies`
   * prop on {@link RoleProps} do not appear in this map.
   */
  inlinePolicies: Record<string, PolicyDocument>;
}

/**
 * A fluent builder for configuring and creating an AWS IAM role.
 *
 * Each configuration property from the CDK {@link RoleProps} is exposed as
 * an overloaded method: call with a value to set it, or with no arguments
 * to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built it creates
 * an IAM role with well-architected defaults ({@link ROLE_DEFAULTS}) and
 * returns a {@link RoleBuilderResult}.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.Role.html
 *
 * @example
 * ```ts
 * const role = createRoleBuilder()
 *   .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
 *   .description("Execution role for the budget remediation Lambda")
 *   .addInlinePolicyStatements("StopEC2", [
 *     createStatementBuilder()
 *       .allow()
 *       .actions(["ec2:StopInstances", "ec2:DescribeInstances"])
 *       .resources(["*"])
 *       .allowWildcardResources(true)
 *       .build(),
 *   ]);
 * ```
 */
export type IRoleBuilder = IBuilder<RoleBuilderProps, RoleBuilder>;

interface InlinePolicyEntry {
  name: string;
  statements: (PolicyStatement | StatementBuilder)[];
}

class RoleBuilder implements Lifecycle<RoleBuilderResult> {
  props: Partial<RoleBuilderProps> = {};
  private readonly _inlinePolicies: InlinePolicyEntry[] = [];

  /**
   * Append an inline policy to the role, embedded in the underlying
   * `AWS::IAM::Role` resource's `Policies` array. The policy name becomes
   * the key under which the resulting {@link PolicyDocument} appears in
   * {@link RoleBuilderResult.inlinePolicies}.
   *
   * Accepts either {@link PolicyStatement} instances or
   * {@link StatementBuilder}s (which are built lazily during {@link build}
   * so that wildcard-resource validation runs at the composition boundary
   * rather than at configuration time).
   */
  addInlinePolicyStatements(
    name: string,
    statements: (PolicyStatement | StatementBuilder)[],
  ): this {
    this._inlinePolicies.push({ name, statements });
    return this;
  }

  build(scope: IConstruct, id: string, context: Record<string, object> = {}): RoleBuilderResult {
    const {
      permissionsBoundary,
      assumedBy,
      inlinePolicies: propsInlinePolicies,
      ...rest
    } = this.props;

    if (!assumedBy) {
      throw new Error(
        `RoleBuilder "${id}": assumedBy(...) must be called before build(). ` +
          `An IAM role requires a trust policy principal.`,
      );
    }

    const resolvedBoundary = permissionsBoundary
      ? resolve(permissionsBoundary, context)
      : undefined;

    const addedInlinePolicies: Record<string, PolicyDocument> = {};
    for (const entry of this._inlinePolicies) {
      const resolvedStatements = entry.statements.map((s) =>
        s instanceof StatementBuilder ? s.build() : s,
      );
      addedInlinePolicies[entry.name] = new PolicyDocument({ statements: resolvedStatements });
    }

    const mergedInlinePolicies: Record<string, PolicyDocument> = {
      ...(propsInlinePolicies ?? {}),
      ...addedInlinePolicies,
    };

    const mergedProps: RoleProps = {
      ...ROLE_DEFAULTS,
      ...rest,
      assumedBy,
      ...(Object.keys(mergedInlinePolicies).length > 0
        ? { inlinePolicies: mergedInlinePolicies }
        : {}),
      ...(resolvedBoundary ? { permissionsBoundary: resolvedBoundary } : {}),
    };

    const role = new Role(scope, id, mergedProps);

    return { role, inlinePolicies: addedInlinePolicies };
  }
}

/**
 * Creates a new {@link IRoleBuilder} for configuring an AWS IAM role.
 *
 * @returns A fluent builder for an AWS IAM role.
 *
 * @example
 * ```ts
 * const role = createRoleBuilder()
 *   .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
 *   .description("Lambda execution role")
 *   .build(stack, "LambdaRole");
 * ```
 */
export function createRoleBuilder(): IRoleBuilder {
  return Builder<RoleBuilderProps, RoleBuilder>(RoleBuilder);
}
