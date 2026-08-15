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
 * Catch this by `name`, not `instanceof`: under the dual ESM/CJS build
 * (ADR-0007) the copy that threw may not be the copy the catching module
 * imported, and `instanceof` is realm-bound.
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
 * @internal Brands every {@link StatementBuilder} instance so
 * {@link isStatementBuilder} can recognise one without `instanceof`.
 * `instanceof` is realm-bound: when `@composurecdk/iam` is loaded as both ESM
 * and CommonJS in the same process (the dual-package hazard — ADR-0007), each
 * copy has its own `StatementBuilder` class and `instanceof` fails across the
 * boundary. A `Symbol.for(...)` brand is registered in the global symbol
 * registry, so a builder minted by either copy is still recognised by either.
 */
export const STATEMENT_BUILDER_BRAND = Symbol.for("composurecdk.statement-builder");

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
  /** @internal Realm-agnostic brand — see {@link STATEMENT_BUILDER_BRAND}. */
  readonly [STATEMENT_BUILDER_BRAND] = true;

  #sid?: string;
  #effect: Effect = Effect.ALLOW;
  #actions: string[] = [];
  #notActions: string[] = [];
  #resources: string[] = [];
  #notResources: string[] = [];
  #principals: IPrincipal[] = [];
  #notPrincipals: IPrincipal[] = [];
  #conditions?: Record<string, Record<string, unknown>>;
  #allowWildcardResources = false;

  sid(sid: string): this {
    this.#sid = sid;
    return this;
  }

  allow(): this {
    this.#effect = Effect.ALLOW;
    return this;
  }

  deny(): this {
    this.#effect = Effect.DENY;
    return this;
  }

  effect(effect: Effect): this {
    this.#effect = effect;
    return this;
  }

  actions(actions: string[]): this {
    this.#actions = [...actions];
    return this;
  }

  notActions(actions: string[]): this {
    this.#notActions = [...actions];
    return this;
  }

  resources(resources: string[]): this {
    this.#resources = [...resources];
    return this;
  }

  notResources(resources: string[]): this {
    this.#notResources = [...resources];
    return this;
  }

  principals(principals: IPrincipal[]): this {
    this.#principals = [...principals];
    return this;
  }

  notPrincipals(principals: IPrincipal[]): this {
    this.#notPrincipals = [...principals];
    return this;
  }

  conditions(conditions: Record<string, Record<string, unknown>>): this {
    this.#conditions = { ...conditions };
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
    this.#allowWildcardResources = allow;
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
      this.#effect === Effect.ALLOW &&
      !this.#allowWildcardResources &&
      this.#resources.some((r) => r === "*")
    ) {
      throw new WildcardResourceError(this.#sid);
    }

    const props: PolicyStatementProps = {
      sid: this.#sid,
      effect: this.#effect,
      actions: this.#actions.length > 0 ? this.#actions : undefined,
      notActions: this.#notActions.length > 0 ? this.#notActions : undefined,
      resources: this.#resources.length > 0 ? this.#resources : undefined,
      notResources: this.#notResources.length > 0 ? this.#notResources : undefined,
      principals: this.#principals.length > 0 ? this.#principals : undefined,
      notPrincipals: this.#notPrincipals.length > 0 ? this.#notPrincipals : undefined,
      conditions: this.#conditions,
    };

    return new PolicyStatement(props);
  }
}

/**
 * Type guard distinguishing a {@link StatementBuilder} from an already-built
 * {@link PolicyStatement}.
 *
 * Recognises a builder by its {@link STATEMENT_BUILDER_BRAND} symbol rather
 * than `instanceof`, so it works across the dual-package boundary — a builder
 * produced by the ESM copy of `@composurecdk/iam` is still recognised by the
 * CommonJS copy and vice versa. Getting this wrong is not merely a type
 * confusion: the discrimination decides whether {@link StatementBuilder.build}
 * runs, and `build()` is where the wildcard-resource guard lives.
 */
export function isStatementBuilder(value: unknown): value is StatementBuilder {
  return typeof value === "object" && value !== null && STATEMENT_BUILDER_BRAND in value;
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
