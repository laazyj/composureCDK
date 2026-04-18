import { ManagedPolicy, type ManagedPolicyProps, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { StatementBuilder } from "./statement-builder.js";

/**
 * Configuration properties for the customer-managed IAM policy builder.
 *
 * Extends the CDK {@link ManagedPolicyProps} unchanged — the builder adds
 * an {@link IManagedPolicyBuilder.addStatements | addStatements} method that
 * accepts either {@link PolicyStatement} or {@link StatementBuilder}.
 */
export type ManagedPolicyBuilderProps = ManagedPolicyProps;

/**
 * The build output of an {@link IManagedPolicyBuilder}.
 */
export interface ManagedPolicyBuilderResult {
  /** The customer-managed policy created by the builder. */
  policy: ManagedPolicy;
}

/**
 * A fluent builder for configuring and creating an AWS IAM
 * customer-managed policy.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_iam.ManagedPolicy.html
 *
 * @example
 * ```ts
 * const boundary = createManagedPolicyBuilder()
 *   .managedPolicyName("ops-boundary")
 *   .addStatements([
 *     createStatementBuilder()
 *       .allow()
 *       .actions(["s3:GetObject"])
 *       .resources(["arn:aws:s3:::my-bucket/*"]),
 *   ]);
 * ```
 */
export type IManagedPolicyBuilder = IBuilder<ManagedPolicyBuilderProps, ManagedPolicyBuilder>;

class ManagedPolicyBuilder implements Lifecycle<ManagedPolicyBuilderResult> {
  props: Partial<ManagedPolicyBuilderProps> = {};
  private readonly _extraStatements: (PolicyStatement | StatementBuilder)[] = [];

  /**
   * Append policy statements to the managed policy.
   *
   * Accepts either {@link PolicyStatement} or {@link StatementBuilder}.
   * Statement builders are resolved during {@link build} so wildcard-resource
   * validation runs at the composition boundary.
   */
  addStatements(statements: (PolicyStatement | StatementBuilder)[]): this {
    this._extraStatements.push(...statements);
    return this;
  }

  build(scope: IConstruct, id: string): ManagedPolicyBuilderResult {
    const resolvedExtras = this._extraStatements.map((s) =>
      s instanceof StatementBuilder ? s.build() : s,
    );

    const mergedProps: ManagedPolicyProps = {
      ...this.props,
      statements: [...(this.props.statements ?? []), ...resolvedExtras],
    };

    const policy = new ManagedPolicy(scope, id, mergedProps);
    return { policy };
  }
}

/**
 * Creates a new {@link IManagedPolicyBuilder} for configuring an AWS IAM
 * customer-managed policy.
 *
 * @returns A fluent builder for a customer-managed policy.
 */
export function createManagedPolicyBuilder(): IManagedPolicyBuilder {
  return Builder<ManagedPolicyBuilderProps, ManagedPolicyBuilder>(ManagedPolicyBuilder);
}
