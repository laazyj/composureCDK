import type { IGrantable, IRole } from "aws-cdk-lib/aws-iam";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import {
  DefinitionBody,
  type IChainable,
  LogLevel,
  StateMachine,
  type StateMachineProps,
  StateMachineType,
} from "aws-cdk-lib/aws-stepfunctions";
import { Construct, type IConstruct } from "constructs";
import {
  combine,
  COPY_STATE,
  type Grant,
  GrantQueue,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { createLogGroupBuilder } from "@composurecdk/logs";
import { STATE_MACHINE_DEFAULTS, STATE_MACHINE_LOG_DEFAULTS } from "./defaults.js";
import {
  LOG_GROUP_NAME_MAX_LENGTH,
  lazyUniqueName,
  STATE_MACHINE_NAME_MAX_LENGTH,
  VENDED_LOG_GROUP_PREFIX,
} from "./physical-names.js";

/**
 * True for a `DefinitionBody.fromChainable(...)` body. Read by shape rather
 * than `instanceof ChainDefinitionBody`, which fails across the ESM and CJS
 * copies of aws-cdk-lib.
 */
function isChainBody(body: DefinitionBody): boolean {
  return "chainable" in body;
}

/**
 * Builds a state machine's workflow from the scope its states are created in.
 *
 * Step Functions states (`Pass`, `Choice`, `LambdaInvoke`, …) are CDK
 * constructs, so they need a scope — and in a composed system the resources a
 * task calls do not exist until build time. The builder therefore takes the
 * definition as a callback it invokes during {@link Lifecycle.build}, with a
 * scope reserved for this state machine's states. Wrap the callback in a `ref`
 * or `combine` to reach the siblings its tasks call.
 */
export type StateMachineDefinition = (scope: Construct) => IChainable;

/**
 * Configuration properties for the Step Functions state machine builder.
 *
 * The CDK {@link StateMachineProps} surface, less the deprecated `definition`
 * (the workflow is set with {@link IStateMachineBuilder.definition} or
 * `definitionBody`). `definitionBody`, `role` and `encryptionConfiguration` are
 * widened to {@link Resolvable}, and `definitionSubstitutions` to a record of
 * `Resolvable` values, so each can come from a composed sibling. Each reads its
 * inner type from CDK's own prop so it keeps tracking `aws-cdk-lib` (ADR-0018).
 */
export interface StateMachineBuilderProps extends Omit<
  StateMachineProps,
  | "definition"
  | "definitionBody"
  | "definitionSubstitutions"
  | "role"
  | "encryptionConfiguration"
  | "logs"
> {
  /**
   * Execution-history logging, merged over the defaults for the state
   * machine's type (`STATE_MACHINE_LOG_DEFAULTS`). The builder creates the log
   * group when `destination` is unset and the level is not `OFF`. Re-declared
   * as `Partial` because `destination` is required on CDK's `LogOptions` at
   * this package's floor, which would make a partial override — or
   * `{ level: LogLevel.OFF }` — impossible to express there.
   */
  logs?: Partial<NonNullable<StateMachineProps["logs"]>>;

  /**
   * A pre-built definition: an Amazon States Language document from a file or
   * string (`DefinitionBody.fromFile(...)`), or a chain whose states were
   * created outside the builder.
   *
   * Mutually exclusive with {@link IStateMachineBuilder.definition}, the
   * preferred form for a workflow written in CDK.
   *
   * An ASL document carries no IAM: CDK cannot see which resources its tasks
   * call, so grant them with {@link IStateMachineBuilder.grant}.
   */
  definitionBody?: Resolvable<NonNullable<StateMachineProps["definitionBody"]>>;

  /**
   * Values substituted for `${key}` placeholders in an ASL
   * {@link definitionBody} — typically the ARNs of the resources its tasks call.
   *
   * Each **value** is independently {@link Resolvable}, so a sibling's ARN can
   * sit beside a literal (e.g.
   * `{ ValidateFn: ref("validate", (r) => r.function.functionArn), Stage: "prod" }`).
   */
  definitionSubstitutions?: Record<
    string,
    Resolvable<NonNullable<StateMachineProps["definitionSubstitutions"]>[string]>
  >;

  /**
   * The execution role the state machine runs as. Accepts a concrete role or a
   * {@link Resolvable}. When unset, CDK creates one and adds the policy each
   * task state needs, plus log delivery and X-Ray.
   */
  role?: Resolvable<NonNullable<StateMachineProps["role"]>>;

  /**
   * Server-side encryption of the definition and execution history. Step
   * Functions encrypts with an AWS-owned key by default; pass a
   * `CustomerManagedEncryptionConfiguration` to use your own key —
   * typically mapped from a composed `@composurecdk/kms` key builder.
   *
   * @see https://docs.aws.amazon.com/step-functions/latest/dg/encryption-at-rest.html
   */
  encryptionConfiguration?: Resolvable<NonNullable<StateMachineProps["encryptionConfiguration"]>>;
}

/**
 * The build output of a {@link IStateMachineBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface StateMachineBuilderResult {
  /** The Step Functions state machine construct created by the builder. */
  stateMachine: StateMachine;

  /**
   * The execution role the state machine runs as — the role supplied via
   * {@link IStateMachineBuilder.role}, or the one CDK created.
   */
  role: IRole;

  /**
   * The log group the builder created for execution history, or `undefined`
   * when the caller supplied a `logs.destination` or turned logging off.
   */
  logGroup?: LogGroup;
}

/**
 * A fluent builder for configuring and creating an AWS Step Functions state
 * machine.
 *
 * Each configuration property from the CDK {@link StateMachineProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * Defaults (execution-history logging, X-Ray tracing) are listed in
 * {@link STATE_MACHINE_DEFAULTS} and {@link STATE_MACHINE_LOG_DEFAULTS}. The
 * state machine is a grantee: {@link IStateMachineBuilder.grant} adds to its
 * execution role.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_stepfunctions-readme.html
 */
export type IStateMachineBuilder = ITaggedBuilder<StateMachineBuilderProps, StateMachineBuilder>;

class StateMachineBuilder implements Lifecycle<StateMachineBuilderResult> {
  props: Partial<StateMachineBuilderProps> = {};
  readonly #grants = new GrantQueue<IGrantable>();
  #definition?: Resolvable<StateMachineDefinition>;

  /**
   * Set the workflow, written in CDK — see {@link StateMachineDefinition}.
   * The callback runs at build time with a scope reserved for this state
   * machine's states, so state ids need only be unique within the workflow.
   *
   * Mutually exclusive with `definitionBody`. Calling it again replaces the
   * previous definition.
   */
  definition(definition: Resolvable<StateMachineDefinition>): this {
    this.#definition = definition;
    return this;
  }

  /**
   * Grant this state machine's execution role access to a resource built by a
   * sibling component — one its tasks call but CDK cannot see, such as a
   * resource named in an ASL document. Each {@link Grant} comes from a resource
   * package's capability helper and is applied during {@link build}.
   *
   * @see ADR-0013
   */
  grant(...grants: Grant<IGrantable>[]): this {
    this.#grants.add(...grants);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: StateMachineBuilder): void {
    this.#grants.copyInto(target.#grants);
    target.#definition = this.#definition;
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): StateMachineBuilderResult {
    const {
      definitionBody,
      definitionSubstitutions,
      role,
      encryptionConfiguration,
      logs,
      ...stateMachineProps
    } = this.props;

    const stateMachineType = stateMachineProps.stateMachineType ?? StateMachineType.STANDARD;

    // Validated before any construct is created.
    const workflow = this.#resolveWorkflow(id, definitionBody, context);
    // CDK writes `.timeout()` into the ASL only for a chain; Express is capped at five minutes.
    if (
      ("build" in workflow || isChainBody(workflow.body)) &&
      stateMachineProps.timeout === undefined &&
      stateMachineType === StateMachineType.STANDARD
    ) {
      throw new Error(
        `StateMachineBuilder "${id}" requires a timeout for a Standard workflow, or an ` +
          `execution can wait up to a year on a task that never answers. Call .timeout(...); ` +
          `to allow the maximum deliberately, set Duration.days(365).`,
      );
    }

    // The log group name and a generated state machine name are both derived
    // from the state machine, which does not exist until the end of build().
    // They resolve lazily, at synth, by when it has been assigned.
    const built: { stateMachine?: StateMachine } = {};
    const owner = () => built.stateMachine;

    const logOptions = { ...STATE_MACHINE_LOG_DEFAULTS[stateMachineType], ...logs };
    let logGroup: LogGroup | undefined;
    if (logOptions.destination === undefined && logOptions.level !== LogLevel.OFF) {
      logGroup = createLogGroupBuilder()
        .logGroupName(lazyUniqueName(owner, LOG_GROUP_NAME_MAX_LENGTH, VENDED_LOG_GROUP_PREFIX))
        .build(scope, `${id}Logs`, context).logGroup;
    }
    const destination = logOptions.destination ?? logGroup;

    const body =
      "build" in workflow
        ? DefinitionBody.fromChainable(workflow.build(new Construct(scope, `${id}Definition`)))
        : workflow.body;

    const mergedProps: StateMachineProps = {
      ...STATE_MACHINE_DEFAULTS,
      ...stateMachineProps,
      definitionBody: body,
      // Leave `logs` unset when logging is OFF: CDK 2.160.0 dereferences the
      // absent destination and throws.
      ...(destination !== undefined ? { logs: { ...logOptions, destination } } : {}),
      ...(definitionSubstitutions !== undefined
        ? { definitionSubstitutions: resolve(combine(definitionSubstitutions), context) }
        : {}),
      ...(role !== undefined ? { role: resolve(role, context) } : {}),
      ...(encryptionConfiguration !== undefined
        ? { encryptionConfiguration: resolve(encryptionConfiguration, context) }
        : {}),
      // Always named: CDK conditions the role's customer-managed-key grant on
      // the ARN built from the name, which for an unnamed state machine ends at
      // `stateMachine:` and matches nothing. Naming it up front, rather than
      // only once a key is set, keeps the name — and so the resource — stable
      // when encryption is turned on later. Keep it even once CDK fixes the
      // condition: dropping the name would rename, and so replace, every
      // deployed state machine.
      // https://github.com/aws/aws-cdk/issues/38958
      stateMachineName:
        stateMachineProps.stateMachineName ?? lazyUniqueName(owner, STATE_MACHINE_NAME_MAX_LENGTH),
    };

    const stateMachine = new StateMachine(scope, id, mergedProps);
    built.stateMachine = stateMachine;
    this.#grants.applyTo(stateMachine, context);

    return { stateMachine, role: stateMachine.role, logGroup };
  }

  /**
   * The workflow to build, resolved without creating any construct: either a
   * callback still to be given its scope, or a pre-built definition body.
   */
  #resolveWorkflow(
    id: string,
    definitionBody: StateMachineBuilderProps["definitionBody"],
    context: Record<string, object>,
  ): { build: StateMachineDefinition } | { body: DefinitionBody } {
    if (this.#definition !== undefined && definitionBody !== undefined) {
      throw new Error(
        `StateMachineBuilder "${id}": .definition() and .definitionBody() are mutually exclusive.`,
      );
    }
    if (this.#definition !== undefined) return { build: resolve(this.#definition, context) };
    if (definitionBody !== undefined) return { body: resolve(definitionBody, context) };
    throw new Error(
      `StateMachineBuilder "${id}" requires a workflow. Call .definition() or .definitionBody().`,
    );
  }
}

/**
 * Creates a new {@link IStateMachineBuilder} for configuring an AWS Step
 * Functions state machine.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     validate: createFunctionBuilder()...,
 *     workflow: createStateMachineBuilder()
 *       .timeout(Duration.minutes(5))
 *       .definition(
 *         ref("validate", (r: FunctionBuilderResult) => (scope: Construct) =>
 *           new LambdaInvoke(scope, "Validate", { lambdaFunction: r.function })
 *             .next(new Succeed(scope, "Done"))),
 *       ),
 *   },
 *   { validate: [], workflow: ["validate"] },
 * );
 * ```
 */
export function createStateMachineBuilder(): IStateMachineBuilder {
  return taggedBuilder<StateMachineBuilderProps, StateMachineBuilder>(StateMachineBuilder);
}
