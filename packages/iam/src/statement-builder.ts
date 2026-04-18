import {
  Effect,
  type IPrincipal,
  PolicyStatement,
  type PolicyStatementProps,
} from "aws-cdk-lib/aws-iam";

/**
 * Thrown when a {@link StatementBuilder} is built with an `Allow` effect and
 * an unrestricted resource (`"*"`) without the caller having explicitly
 * opted in via {@link StatementBuilder.allowWildcardResources}.
 *
 * Wildcard-resource allow statements grant the widest possible permission
 * surface and should be an intentional choice, not an accident.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/permissions-management.html
 */
export class WildcardResourceError extends Error {
  constructor(sid?: string) {
    super(
      `PolicyStatement${sid ? ` "${sid}"` : ""} has Effect=Allow with a wildcard resource ("*"). ` +
        `Scope the resources or call allowWildcardResources(true) to opt in explicitly.`,
    );
    this.name = "WildcardResourceError";
  }
}

/**
 * Fluent wrapper around the CDK {@link PolicyStatement}.
 *
 * Unlike other ComposureCDK builders this one is **not** a
 * {@link Lifecycle} — a policy statement is inline data attached to a Role,
 * ManagedPolicy, or resource policy rather than a standalone CDK construct,
 * so there is nothing to attach to a scope.
 *
 * The builder exists to:
 * - centralise least-privilege validation (wildcard-resource guard,
 *   {@link WildcardResourceError}),
 * - give every consumer (Role, ManagedPolicy, SNS TopicPolicy, future
 *   SQS/S3 bucket policies) one fluent API,
 * - remain interchangeable with raw {@link PolicyStatement} instances via
 *   {@link StatementBuilder.build}.
 *
 * @example
 * ```ts
 * const stmt = createStatementBuilder()
 *   .sid("StopDevInstances")
 *   .allow()
 *   .actions(["ec2:StopInstances", "ec2:DescribeInstances"])
 *   .resources(["*"])
 *   .allowWildcardResources(true)
 *   .build();
 * ```
 */
export class StatementBuilder {
  private _sid?: string;
  private _effect: Effect = Effect.ALLOW;
  private _actions: string[] = [];
  private _notActions: string[] = [];
  private _resources: string[] = [];
  private _notResources: string[] = [];
  private _principals: IPrincipal[] = [];
  private _notPrincipals: IPrincipal[] = [];
  private _conditions?: Record<string, Record<string, unknown>>;
  private _allowWildcardResources = false;

  sid(sid: string): this {
    this._sid = sid;
    return this;
  }

  allow(): this {
    this._effect = Effect.ALLOW;
    return this;
  }

  deny(): this {
    this._effect = Effect.DENY;
    return this;
  }

  effect(effect: Effect): this {
    this._effect = effect;
    return this;
  }

  actions(actions: string[]): this {
    this._actions = [...actions];
    return this;
  }

  notActions(actions: string[]): this {
    this._notActions = [...actions];
    return this;
  }

  resources(resources: string[]): this {
    this._resources = [...resources];
    return this;
  }

  notResources(resources: string[]): this {
    this._notResources = [...resources];
    return this;
  }

  principals(principals: IPrincipal[]): this {
    this._principals = [...principals];
    return this;
  }

  notPrincipals(principals: IPrincipal[]): this {
    this._notPrincipals = [...principals];
    return this;
  }

  conditions(conditions: Record<string, Record<string, unknown>>): this {
    this._conditions = { ...conditions };
    return this;
  }

  /**
   * Opt in to Effect=Allow statements with wildcard resources (`"*"`).
   *
   * The builder rejects wildcard resources by default to surface
   * least-privilege violations; call this to acknowledge that the
   * statement genuinely needs unrestricted scope (for example actions
   * such as `ec2:DescribeInstances` that do not support resource-level
   * permissions).
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_actions-resources-contextkeys.html
   */
  allowWildcardResources(allow = true): this {
    this._allowWildcardResources = allow;
    return this;
  }

  /**
   * Construct and return a {@link PolicyStatement} from the configured state.
   *
   * @throws {WildcardResourceError} when the statement is an Allow with a
   *   wildcard resource and wildcard resources have not been opted in to.
   */
  build(): PolicyStatement {
    if (
      this._effect === Effect.ALLOW &&
      !this._allowWildcardResources &&
      this._resources.some((r) => r === "*")
    ) {
      throw new WildcardResourceError(this._sid);
    }

    const props: PolicyStatementProps = {
      sid: this._sid,
      effect: this._effect,
      actions: this._actions.length > 0 ? this._actions : undefined,
      notActions: this._notActions.length > 0 ? this._notActions : undefined,
      resources: this._resources.length > 0 ? this._resources : undefined,
      notResources: this._notResources.length > 0 ? this._notResources : undefined,
      principals: this._principals.length > 0 ? this._principals : undefined,
      notPrincipals: this._notPrincipals.length > 0 ? this._notPrincipals : undefined,
      conditions: this._conditions,
    };

    return new PolicyStatement(props);
  }
}

/**
 * Creates a new {@link StatementBuilder} for configuring an IAM
 * {@link PolicyStatement} with least-privilege guardrails.
 *
 * @returns A fluent builder that produces a {@link PolicyStatement} when
 *   {@link StatementBuilder.build} is called.
 */
export function createStatementBuilder(): StatementBuilder {
  return new StatementBuilder();
}
