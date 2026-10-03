import type { IGrantable, IRole } from "aws-cdk-lib/aws-iam";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import { Annotations } from "aws-cdk-lib";
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
 * Warning id for a Standard state machine built from a chain with no timeout.
 * Acknowledge it with `Annotations.of(scope).acknowledgeWarning(...)` where an
 * unbounded execution is intended.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_client_timeouts.html
 */
export const STATE_MACHINE_TIMEOUT_WARNING_ID = "@composurecdk/stepfunctions:no-timeout";

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
  "definition" | "definitionBody" | "definitionSubstitutions" | "role" | "encryptionConfiguration"
> {
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
   * `CustomerManagedKeyEncryptionConfiguration` to use your own key —
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

    // The log group name and a generated state machine name are both derived
    // from the state machine, which does not exist until the end of build().
    // They resolve lazily, at synth, by when it has been assigned.
    const built: { stateMachine?: StateMachine } = {};
    const owner = () => built.stateMachine;

    const resolvedLogs = { ...STATE_MACHINE_LOG_DEFAULTS[stateMachineType], ...logs };
    let logGroup: LogGroup | undefined;
    if (resolvedLogs.destination === undefined && resolvedLogs.level !== LogLevel.OFF) {
      logGroup = createLogGroupBuilder()
        .logGroupName(lazyUniqueName(owner, LOG_GROUP_NAME_MAX_LENGTH, VENDED_LOG_GROUP_PREFIX))
        .build(scope, `${id}Logs`, context).logGroup;
      resolvedLogs.destination = logGroup;
    }

    const body = this.#resolveDefinitionBody(scope, id, definitionBody, context);

    const mergedProps: StateMachineProps = {
      ...STATE_MACHINE_DEFAULTS,
      ...stateMachineProps,
      definitionBody: body,
      logs: resolvedLogs,
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
      // when encryption is turned on later.
      stateMachineName:
        stateMachineProps.stateMachineName ?? lazyUniqueName(owner, STATE_MACHINE_NAME_MAX_LENGTH),
    };

    const stateMachine = new StateMachine(scope, id, mergedProps);
    built.stateMachine = stateMachine;
    this.#grants.applyTo(stateMachine, context);

    // CDK writes the timeout into the ASL only for a chain; an ASL document
    // carries its own `TimeoutSeconds`, and an Express execution is capped at
    // five minutes regardless.
    if (
      isChainBody(body) &&
      mergedProps.timeout === undefined &&
      stateMachineType === StateMachineType.STANDARD
    ) {
      Annotations.of(stateMachine).addWarningV2(
        STATE_MACHINE_TIMEOUT_WARNING_ID,
        `StateMachineBuilder "${id}": no timeout. A Standard execution with none can wait up ` +
          `to a year on a task that never answers. Set .timeout(...) to bound it.`,
      );
    }

    return { stateMachine, role: stateMachine.role, logGroup };
  }

  #resolveDefinitionBody(
    scope: IConstruct,
    id: string,
    definitionBody: StateMachineBuilderProps["definitionBody"],
    context: Record<string, object>,
  ): DefinitionBody {
    if (this.#definition !== undefined && definitionBody !== undefined) {
      throw new Error(
        `StateMachineBuilder "${id}": .definition() and .definitionBody() are mutually exclusive.`,
      );
    }
    if (definitionBody !== undefined) return resolve(definitionBody, context);
    if (this.#definition === undefined) {
      throw new Error(
        `StateMachineBuilder "${id}": no workflow. Set one with .definition() or .definitionBody().`,
      );
    }
    const states = new Construct(scope, `${id}Definition`);
    return DefinitionBody.fromChainable(resolve(this.#definition, context)(states));
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
