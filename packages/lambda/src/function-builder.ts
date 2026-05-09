import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IRole, ManagedPolicy } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction, type FunctionProps } from "aws-cdk-lib/aws-lambda";
import type { ILogGroup, LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
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

const LOGS_WRITER_POLICY_NAME = "LogsWriter";

/**
 * Configuration properties for the Lambda function builder.
 *
 * Extends the CDK {@link FunctionProps} with builder-specific options. The
 * `role` prop is widened to {@link Resolvable} so a role built by a sibling
 * component can be referenced via `ref(...)` at configuration time.
 */
export interface FunctionBuilderProps extends Omit<FunctionProps, "role"> {
  /**
   * The IAM execution role to attach to the function. When set, the builder
   * skips creating its own role and the auto-created `LogsWriter` inline
   * policy is **not** added — the caller is fully responsible for the role's
   * permissions.
   *
   * Accepts a concrete {@link IRole} or a {@link Resolvable} for
   * cross-component wiring (e.g. `ref("sharedRole", r => r.role)`).
   *
   * Mutually exclusive with {@link IFunctionBuilder.configureRole} and
   * {@link IFunctionBuilder.useCdkAutoRole}.
   */
  role?: Resolvable<IRole>;

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for every applicable metric. Individual alarms can be
   * customized or disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * Contextual alarms (duration, concurrentExecutions) are only created
   * when the corresponding function configuration is present.
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

class FunctionBuilder implements Lifecycle<FunctionBuilderResult> {
  props: Partial<FunctionBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<LambdaFunction>[] = [];
  #configureRole?: (rb: IRoleBuilder) => unknown;
  #useCdkAutoRole = false;

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

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: FunctionBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
    target.#configureRole = this.#configureRole;
    target.#useCdkAutoRole = this.#useCdkAutoRole;
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): FunctionBuilderResult {
    const { role: roleResolvable, recommendedAlarms: alarmConfig, ...functionProps } = this.props;

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
      logGroup = createLogGroupBuilder().build(scope, `${id}LogGroup`).logGroup;
      logGroupProps = { logGroup };
    }

    let role: IRole | undefined;
    if (roleResolvable !== undefined) {
      role = resolve(roleResolvable, context);
    } else if (!this.#useCdkAutoRole) {
      role = this.#buildDefaultRole(
        scope,
        id,
        context,
        (logGroup ?? this.props.logGroup) as ILogGroup | undefined,
      );
    }

    const mergedProps = {
      ...FUNCTION_DEFAULTS,
      ...logGroupProps,
      ...functionProps,
      ...(role ? { role } : {}),
    } as FunctionProps;

    const fn = new LambdaFunction(scope, id, mergedProps);

    const alarms = createFunctionAlarms(
      scope,
      id,
      fn,
      alarmConfig,
      mergedProps,
      this.#customAlarms,
    );

    const resolvedRole = role ?? fn.role;
    if (!resolvedRole) {
      throw new Error(`FunctionBuilder "${id}": Lambda function has no execution role.`);
    }

    return { function: fn, role: resolvedRole, logGroup, alarms };
  }

  #buildDefaultRole(
    scope: IConstruct,
    id: string,
    context: Record<string, object>,
    logGroup: ILogGroup | undefined,
  ): IRole {
    if (!logGroup) {
      throw new Error(
        `FunctionBuilder "${id}": cannot build the default execution role without a log group.`,
      );
    }
    const logGroupArn = logGroup.logGroupArn;
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
