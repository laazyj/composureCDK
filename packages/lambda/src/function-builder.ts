import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IGrantable, type IRole, ManagedPolicy } from "aws-cdk-lib/aws-iam";
import {
  Function as LambdaFunction,
  type FunctionProps,
  type IEventSource,
} from "aws-cdk-lib/aws-lambda";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import type { Trigger } from "aws-cdk-lib/triggers";
import { type IConstruct } from "constructs";
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
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import {
  createServiceRoleBuilder,
  createStatementBuilder,
  type IRoleBuilder,
} from "@composurecdk/iam";
import { createLogGroupBuilder } from "@composurecdk/logs";
import type { FunctionAlarmConfig } from "./alarm-config.js";
import { createFunctionAlarms } from "./function-alarms.js";
import { FUNCTION_DEFAULTS } from "./defaults.js";
import {
  type AttachedEventSource,
  type ComposureEventSource,
  EVENT_SOURCE_MAPPING_ID_READERS,
  isComposureEventSource,
} from "./event-sources/composure-event-source.js";
import { EVENT_SOURCE_RELATIONSHIP_GUARDS } from "./event-sources/event-source-relationship-guards.js";
import { createDeploymentTrigger, type InvokeOnDeployOptions } from "./invoke-on-deploy.js";

const LOGS_WRITER_POLICY_NAME = "LogsWriter";

/**
 * The log group's ARN, wherever the installed `aws-cdk-lib` keeps it.
 *
 * `FunctionProps.logGroup` is `logs.ILogGroup` at this package's floor and
 * `logs.ILogGroupRef` on current CDK, and the ARN sits somewhere different on
 * each: `logGroupArn` on the L2 interface, `logGroupRef.logGroupArn` on the
 * reference interface. Neither member compiles against both ends of the
 * supported range, and narrowing the prop to the one we can read is what
 * ADR-0018 forbids, so the value is read structurally instead.
 *
 * Reading it through a cast to `ILogGroup` instead produced
 * `Resource: ["undefined:log-stream:*"]` for a log group that only exposes the
 * reference form: a policy that grants the function nothing, and that
 * CloudFormation rejects as a malformed ARN.
 */
function logGroupArnOf(logGroup: NonNullable<FunctionProps["logGroup"]>, id: string): string {
  const shape = logGroup as { logGroupArn?: string; logGroupRef?: { logGroupArn?: string } };
  const arn = shape.logGroupArn ?? shape.logGroupRef?.logGroupArn;
  if (arn === undefined) {
    throw new Error(
      `FunctionBuilder "${id}": the supplied logGroup exposes no ARN, so the default ` +
        `execution role's ${LOGS_WRITER_POLICY_NAME} policy cannot be scoped to it. ` +
        `Supply a log group that does, or bring your own role with .role() / .useCdkAutoRole().`,
    );
  }
  return arn;
}

/**
 * Configuration properties for the Lambda function builder.
 *
 * Extends the CDK {@link FunctionProps} with builder-specific options. The
 * `role` and `environmentEncryption` are widened to {@link Resolvable}, and
 * `environment` to a record of `Resolvable` values, so a role, key or value
 * built by a sibling component can be referenced via `ref(...)` at
 * configuration time. Each reads its inner type from CDK's own prop so they
 * keep tracking it (ADR-0018).
 */
export interface FunctionBuilderProps extends Omit<
  FunctionProps,
  "role" | "environmentEncryption" | "environment"
> {
  /**
   * The IAM execution role to attach to the function. When set, the builder
   * skips creating its own role and the auto-created `LogsWriter` inline
   * policy is **not** added — the caller is fully responsible for the role's
   * permissions.
   *
   * Accepts a concrete role or a {@link Resolvable} for cross-component wiring
   * (e.g. `ref("sharedRole", r => r.role)`).
   *
   * Mutually exclusive with {@link IFunctionBuilder.configureRole} and
   * {@link IFunctionBuilder.useCdkAutoRole}.
   */
  role?: Resolvable<NonNullable<FunctionProps["role"]>>;

  /**
   * The customer-managed KMS key used to encrypt the function's environment
   * variables at rest.
   *
   * Accepts a concrete key or a {@link Resolvable} — typically a {@link Ref}
   * to a composed `@composurecdk/kms` key builder, so the key is a component
   * of the system rather than a construct built outside it.
   *
   * Lambda encrypts environment variables with an AWS-managed key by default,
   * so this prop opts into a customer-managed one. The key policy must allow
   * the function's execution role to decrypt — CDK adds that grant for a key
   * it can see.
   *
   * The inner type is read from CDK's own prop rather than named as `IKey`, so
   * it tracks the `kms.IKey` → `kms.IKeyRef` migration in either direction —
   * see the table in `@composurecdk/kms`'s README.
   *
   * @see https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html#configuration-envvars-encryption
   */
  environmentEncryption?: Resolvable<NonNullable<FunctionProps["environmentEncryption"]>>;

  /**
   * Key-value pairs the function can read from `process.env` (e.g.
   * `.environment({ API_URL: ref("api", (r) => r.api.url), LOG_LEVEL: "info" })`).
   *
   * Each **value** is independently {@link Resolvable}, rather than the record
   * as a whole, because mixing a reference with literals is the common case:
   * wrapping the record would push every literal through the same `ref`, and
   * through {@link combine} as soon as two siblings are involved. Matches
   * `validationZones` in `@composurecdk/acm`.
   *
   * The value type is read from CDK's own prop rather than written as `string`,
   * so it tracks `aws-cdk-lib` (ADR-0018).
   */
  environment?: Record<string, Resolvable<NonNullable<FunctionProps["environment"]>[string]>>;

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for every applicable metric. Individual alarms can be
   * customized or disabled. Set to `false` to disable the recommended
   * alarms; custom alarms added via `addAlarm()` are still created.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * Contextual alarms are only created when the corresponding function
   * configuration is present: `duration` when `timeout` is set,
   * `concurrentExecutions` when `reservedConcurrentExecutions` is set, and
   * the event-source alarms (`eventSourceFailedInvocations`,
   * `eventSourceDroppedEvents`) once an event source is attached via
   * {@link IFunctionBuilder.addEventSource}.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
   */
  recommendedAlarms?: FunctionAlarmConfig | false;
}

/**
 * The build output of a {@link IFunctionBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface FunctionBuilderResult {
  /** The Lambda function construct created by the builder. */
  function: LambdaFunction;

  /**
   * The IAM execution role attached to the function. Always populated:
   * - if the caller supplied a role via {@link IFunctionBuilder.role}, this
   *   is that role;
   * - if {@link IFunctionBuilder.useCdkAutoRole} was called, this is CDK's
   *   auto-created role;
   * - otherwise, this is the explicit role the builder constructed via
   *   `@composurecdk/iam`'s `createServiceRoleBuilder`, with an inline
   *   `LogsWriter` policy scoped to the function's auto-created log group.
   */
  role: IRole;

  /**
   * The CloudWatch LogGroup created for the function, or `undefined` if
   * the user provided their own via the `logGroup` property.
   *
   * By default the builder creates a managed LogGroup using
   * {@link createLogGroupBuilder} with well-architected defaults (retention
   * policy, removal policy). This follows AWS CDK guidance to create a
   * `LogGroup` explicitly rather than relying on the auto-created default,
   * which cannot be configured via CDK.
   *
   * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html
   * @see https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html
   */
  logGroup?: LogGroup;

  /**
   * CloudWatch alarms created for the function, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via {@link IFunctionBuilder.addAlarm}. Access individual alarms
   * by key (e.g., `result.alarms.errors`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
   */
  alarms: Record<string, Alarm>;

  /**
   * Event sources attached to the function via
   * {@link IFunctionBuilder.addEventSource}, keyed by the key passed to that
   * call. Each value is the resolved CDK {@link IEventSource} — for sources
   * built by a ComposureCDK factory (e.g. {@link sqsEventSource}) the
   * concrete type is preserved, so callers can read back post-`bind()` state
   * such as `eventSourceMappingId`.
   *
   * Always present — `{}` when no event sources were added.
   */
  eventSources: Record<string, IEventSource>;

  /**
   * The custom resource that invokes the function during deployment, or
   * `undefined` unless {@link IFunctionBuilder.invokeOnDeploy} was called.
   *
   * Exposed so a sibling can be ordered against the invocation — e.g.
   * `deploymentTrigger.executeBefore(...)` to gate another resource on the
   * call having succeeded.
   *
   * Optional, unlike the always-present `alarms` / `eventSources` beside it:
   * there is no empty `Trigger` to stand in for the absence of one.
   */
  deploymentTrigger?: Trigger;
}

/**
 * A fluent builder for configuring and creating an AWS Lambda function.
 *
 * Each configuration property from the CDK {@link FunctionProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a Lambda function with the configured properties and returns a
 * {@link FunctionBuilderResult}.
 *
 * Unless a user-supplied `logGroup` is provided, the builder automatically
 * creates a managed CloudWatch LogGroup via {@link createLogGroupBuilder}
 * with well-architected defaults (retention, removal policy) and wires it
 * to the function. This ensures full control over log lifecycle and follows
 * AWS CDK guidance to create a LogGroup explicitly.
 *
 * ## Execution role
 *
 * By default the builder creates an explicit IAM role via
 * `@composurecdk/iam`'s `createServiceRoleBuilder("lambda.amazonaws.com")`,
 * with an inline `LogsWriter` policy granting `logs:CreateLogStream` and
 * `logs:PutLogEvents` scoped to the function's auto-created log group.
 * This replaces CDK's default auto-role (which attaches the
 * `AWSLambdaBasicExecutionRole` managed policy granting wildcard log
 * access) with a least-privilege role.
 *
 * Three override seams are available, in order of preference:
 *
 * 1. {@link IFunctionBuilder.configureRole} — extend the default role
 *    builder with additional inline policies, etc.
 * 2. {@link IFunctionBuilder.role} — supply a fully external role; no
 *    `LogsWriter` policy is added.
 * 3. {@link IFunctionBuilder.useCdkAutoRole} — opt back into CDK's
 *    auto-created role with `AWSLambdaBasicExecutionRole`.
 *
 * The seams are mutually exclusive; combining any two throws at build time.
 *
 * The builder also creates AWS-recommended CloudWatch alarms by default.
 * Alarms can be customized or disabled via the `recommendedAlarms` property.
 * Custom alarms can be added via the {@link addAlarm} method.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html
 *
 * @example
 * ```ts
 * const handler = createFunctionBuilder()
 *   .runtime(Runtime.NODEJS_22_X)
 *   .handler("index.handler")
 *   .code(Code.fromAsset("lambda"))
 *   .memorySize(256)
 *   .timeout(Duration.seconds(30));
 * ```
 */
export type IFunctionBuilder = ITaggedBuilder<FunctionBuilderProps, FunctionBuilder>;

interface EventSourceEntry {
  key: string;
  source: Resolvable<ComposureEventSource | IEventSource>;
}

class FunctionBuilder implements Lifecycle<FunctionBuilderResult> {
  props: Partial<FunctionBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<LambdaFunction>[] = [];
  readonly #eventSources: EventSourceEntry[] = [];
  readonly #grants = new GrantQueue<IGrantable>();
  #configureRole?: (rb: IRoleBuilder) => unknown;
  #useCdkAutoRole = false;
  #invokeOnDeploy?: InvokeOnDeployOptions;

  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<LambdaFunction>,
    ) => AlarmDefinitionBuilder<LambdaFunction>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<LambdaFunction>(key)));
    return this;
  }

  /**
   * Register an event source to be attached to the function at build time.
   *
   * A Lambda function can have many event sources of mixed types, so this
   * hook is repeatable and typed to the common {@link IEventSource}. Pass a
   * {@link ComposureEventSource} from a ComposureCDK factory (e.g. {@link sqsEventSource})
   * or a bare concrete {@link IEventSource}.
   *
   * At build time the source is resolved and attached *after* the function
   * (and its least-privilege execution role) exist, so the `source.bind(fn)`
   * that `addEventSource` performs grants the consume permission onto the
   * builder's role. The resolved source is exposed on
   * {@link FunctionBuilderResult.eventSources} under `key`.
   *
   * Sources built by a recognised factory also enable contextual alarms —
   * see {@link FunctionBuilderProps.recommendedAlarms}.
   *
   * @throws If `key` was already used by a previous `addEventSource` call.
   */
  addEventSource(key: string, source: Resolvable<ComposureEventSource | IEventSource>): this {
    if (this.#eventSources.some((e) => e.key === key)) {
      throw new Error(
        `FunctionBuilder.addEventSource: duplicate key "${key}". Each event source must use a unique key.`,
      );
    }
    this.#eventSources.push({ key, source });
    return this;
  }

  /**
   * Extend the default execution-role builder with additional configuration
   * (inline policies, managed-policy attachments, description, etc.).
   *
   * The callback receives the internal {@link IRoleBuilder} that the function
   * builder will use to construct the role. Calling `configureRole` more than
   * once replaces the previous callback. The default `LogsWriter` inline
   * policy is added before the callback runs; supplying another inline
   * policy with the name `LogsWriter` throws at build time.
   *
   * Mutually exclusive with {@link role} and {@link useCdkAutoRole}.
   */
  configureRole(fn: (rb: IRoleBuilder) => unknown): this {
    this.#configureRole = fn;
    return this;
  }

  /**
   * Opt back into CDK's auto-created execution role attached to the
   * `AWSLambdaBasicExecutionRole` managed policy.
   *
   * **Not the recommended path.** The default builder-created role grants
   * `logs:CreateLogStream` and `logs:PutLogEvents` scoped to the function's
   * own log group; CDK's auto-role grants those actions on `*` and also
   * permits `logs:CreateLogGroup` arbitrarily. Use this escape hatch only
   * when matching an existing stack's logical IDs during a phased migration
   * or when the wildcard log surface is a deliberate trade-off.
   *
   * Mutually exclusive with {@link role} and {@link configureRole}.
   */
  useCdkAutoRole(): this {
    this.#useCdkAutoRole = true;
    return this;
  }

  /**
   * Invoke this function once during deployment, and **fail the deployment if
   * it fails** — a domain action for work that must happen as part of shipping
   * the stack, such as registering the release with an external service,
   * verifying the deployed system answers correctly, or seeding reference data
   * through a service API (ADR-0016).
   *
   * The deployment waits for the handler's response. If the handler throws or
   * times out, the stack fails and rolls back, and the handler's error message
   * reaches the CloudFormation stack events.
   *
   * **The handler must throw to fail the deployment.** Returning an error
   * object — an HTTP-shaped `{ statusCode: 500 }`, or a caught error swallowed
   * into the response — is a *successful* invocation as far as Lambda is
   * concerned, and the deployment goes green.
   *
   * Ordering is data: the function's own execution role is always waited for,
   * and anything else the call needs is declared with
   * {@link InvokeOnDeployOptions.after}.
   *
   * The deployment waits for this function's own `timeout` plus 30s, rather
   * than the flat 2 minutes CDK's `Trigger` defaults to, so a handler that runs
   * to its limit reports *its* error instead of the deployment abandoning the
   * call first. The wait is capped at 14m30s — see
   * {@link InvokeOnDeployOptions.timeout}, which throws above that rather than
   * clamping.
   *
   * Calling this more than once replaces the previous options. The resulting
   * custom resource is exposed on
   * {@link FunctionBuilderResult.deploymentTrigger}.
   *
   * @example
   * ```ts
   * createFunctionBuilder()
   *   .runtime(Runtime.NODEJS_22_X)
   *   .handler("index.handler")
   *   .code(Code.fromAsset("register"))
   *   .timeout(Duration.seconds(30))
   *   .invokeOnDeploy({ after: [ref("api", (r: RestApiBuilderResult) => r.api)] });
   * ```
   */
  invokeOnDeploy(options: InvokeOnDeployOptions = {}): this {
    this.#invokeOnDeploy = options;
    return this;
  }

  /**
   * Grant this function's execution role access to a resource built by a
   * sibling component.
   *
   * A Lambda `Function` is an `IGrantable`, so the grant routes onto whichever
   * execution role the function ends up with (the default least-privilege role,
   * a {@link configureRole} extension, an external {@link role}, or the CDK
   * auto-role). Declaring it here keeps the dependency edge pointing from the
   * function to the resource. Each {@link Grant} comes from a resource
   * package's capability helper and is applied during {@link build}.
   *
   * @see ADR-0013
   *
   * @example
   * ```ts
   * createFunctionBuilder()
   *   .grant(bucketGrants.write(ref("bucket", (r) => r.bucket)));
   * ```
   */
  grant(...grants: Grant<IGrantable>[]): this {
    this.#grants.add(...grants);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: FunctionBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
    target.#eventSources.push(...this.#eventSources);
    this.#grants.copyInto(target.#grants);
    target.#configureRole = this.#configureRole;
    target.#useCdkAutoRole = this.#useCdkAutoRole;
    target.#invokeOnDeploy = this.#invokeOnDeploy;
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): FunctionBuilderResult {
    const {
      role: roleResolvable,
      environmentEncryption,
      environment,
      recommendedAlarms: alarmConfig,
      ...functionProps
    } = this.props;

    const seamCount =
      (roleResolvable !== undefined ? 1 : 0) +
      (this.#configureRole !== undefined ? 1 : 0) +
      (this.#useCdkAutoRole ? 1 : 0);
    if (seamCount > 1) {
      throw new Error(
        `FunctionBuilder "${id}": .role(), .configureRole(), and .useCdkAutoRole() are mutually exclusive`,
      );
    }

    let logGroup: LogGroup | undefined;
    let logGroupProps = {};

    if (!this.props.logGroup) {
      logGroup = createLogGroupBuilder().build(scope, `${id}LogGroup`, context).logGroup;
      logGroupProps = { logGroup };
    }

    let role: NonNullable<FunctionProps["role"]> | undefined;
    if (roleResolvable !== undefined) {
      role = resolve(roleResolvable, context);
    } else if (!this.#useCdkAutoRole) {
      role = this.#buildDefaultRole(scope, id, context, logGroup ?? this.props.logGroup);
    }

    const mergedProps = {
      ...FUNCTION_DEFAULTS,
      ...logGroupProps,
      ...functionProps,
      ...(role ? { role } : {}),
      ...(environmentEncryption !== undefined
        ? { environmentEncryption: resolve(environmentEncryption, context) }
        : {}),
      ...(environment !== undefined ? { environment: resolve(combine(environment), context) } : {}),
    } as FunctionProps;

    const fn = new LambdaFunction(scope, id, mergedProps);
    this.#grants.applyTo(fn, context);

    const eventSources: Record<string, IEventSource> = {};
    const attachedEventSources: AttachedEventSource[] = [];
    for (const entry of this.#eventSources) {
      const outer = resolve(entry.source, context);

      let kind: AttachedEventSource["kind"] = "unknown";
      let eventSource: IEventSource;
      if (isComposureEventSource(outer)) {
        kind = outer.kind;
        eventSource = resolve(outer.source, context);
      } else {
        eventSource = outer;
      }

      // Attach after the function exists so the `source.bind(fn)` that
      // `addEventSource` performs grants the consume permission onto the
      // builder's least-privilege role; the mapping UUID is only readable
      // once bound.
      fn.addEventSource(eventSource);
      eventSources[entry.key] = eventSource;
      attachedEventSources.push({
        key: entry.key,
        kind,
        eventSourceMappingId: EVENT_SOURCE_MAPPING_ID_READERS[kind]?.(eventSource),
      });

      // Guard any cross-component relationship that spans this source and the
      // function (e.g. the SQS visibilityTimeout >= 6x function-timeout rule),
      // dispatched on kind so no CDK internals are inspected. See ADR-0011.
      for (const guard of EVENT_SOURCE_RELATIONSHIP_GUARDS[kind]) {
        guard(fn, id, entry.key, eventSource, mergedProps.timeout);
      }
    }

    const alarms = createFunctionAlarms(
      scope,
      id,
      fn,
      alarmConfig,
      mergedProps,
      attachedEventSources,
      this.#customAlarms,
    );

    const resolvedRole = role ?? fn.role;
    if (!resolvedRole) {
      throw new Error(`FunctionBuilder "${id}": Lambda function has no execution role.`);
    }

    // Built last so the invocation is ordered after everything the builder
    // attached to the function — grants included.
    const deploymentTrigger = this.#invokeOnDeploy
      ? createDeploymentTrigger(scope, id, fn, resolvedRole, this.#invokeOnDeploy, context)
      : undefined;

    return { function: fn, role: resolvedRole, logGroup, alarms, eventSources, deploymentTrigger };
  }

  #buildDefaultRole(
    scope: IConstruct,
    id: string,
    context: Record<string, object>,
    logGroup: FunctionProps["logGroup"],
  ): IRole {
    if (!logGroup) {
      throw new Error(
        `FunctionBuilder "${id}": cannot build the default execution role without a log group.`,
      );
    }
    const logGroupArn = logGroupArnOf(logGroup, id);
    const roleBuilder = createServiceRoleBuilder("lambda.amazonaws.com").addInlinePolicyStatements(
      LOGS_WRITER_POLICY_NAME,
      [
        createStatementBuilder()
          .allow()
          .actions(["logs:CreateLogStream", "logs:PutLogEvents"])
          .resources([logGroupArn, `${logGroupArn}:log-stream:*`]),
      ],
    );
    // CDK attaches AWSLambdaVPCAccessExecutionRole only when it constructs
    // the role itself; when we supply the role we must add it ourselves.
    if (this.props.vpc) {
      roleBuilder.managedPolicies([
        ...(roleBuilder.managedPolicies() ?? []),
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
      ]);
    }
    if (this.#configureRole) {
      this.#configureRole(guardLogsWriter(roleBuilder, id));
    }
    return roleBuilder.build(scope, `${id}ExecutionRole`, context).role;
  }
}

/**
 * Creates a new {@link IFunctionBuilder} for configuring an AWS Lambda function.
 *
 * This is the entry point for defining a Lambda function component. The returned
 * builder exposes every {@link FunctionBuilderProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS Lambda function.
 *
 * @example
 * ```ts
 * const handler = createFunctionBuilder()
 *   .runtime(Runtime.NODEJS_22_X)
 *   .handler("index.handler")
 *   .code(Code.fromAsset("lambda"))
 *   .timeout(Duration.seconds(30));
 *
 * // Use standalone:
 * const result = handler.build(stack, "MyFunction");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { handler, table: createTableBuilder() },
 *   { handler: ["table"], table: [] },
 * );
 * ```
 */
export function createFunctionBuilder(): IFunctionBuilder {
  return taggedBuilder<FunctionBuilderProps, FunctionBuilder>(FunctionBuilder);
}

type AddInlinePolicy = IRoleBuilder["addInlinePolicyStatements"];

/**
 * Wraps a role builder so a user configurator that calls
 * `addInlinePolicyStatements("LogsWriter", ...)` fails loudly. RoleBuilder
 * stores inline policies in an internal array and the resulting record uses
 * the policy name as a key — a duplicate `LogsWriter` would silently
 * overwrite the scoped log policy and re-introduce wildcard log access.
 */
function guardLogsWriter(rb: IRoleBuilder, functionId: string): IRoleBuilder {
  const original = rb.addInlinePolicyStatements.bind(rb);
  return new Proxy(rb, {
    get(target, prop, receiver) {
      if (prop === "addInlinePolicyStatements") {
        const guarded: AddInlinePolicy = (name, statements) => {
          if (name === LOGS_WRITER_POLICY_NAME) {
            throw new Error(
              `FunctionBuilder "${functionId}": cannot add an inline policy named ` +
                `"${LOGS_WRITER_POLICY_NAME}" via .configureRole — the builder already ` +
                `attaches one scoped to the function's log group. Use a different ` +
                `name or call .role(...) to take full control of the role.`,
            );
          }
          return original(name, statements);
        };
        return guarded;
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}
