import { Arn, ArnFormat, Stack } from "aws-cdk-lib";
import {
  type DataSourceConfig,
  EVALUATION_CLOUDWATCH_INDEX_POLICY_PERMS,
  EVALUATION_CLOUDWATCH_LOGS_DESCRIBE_PERMS,
  EVALUATION_CLOUDWATCH_LOGS_QUERY_PERMS,
  EVALUATION_CLOUDWATCH_LOGS_WRITE_PERMS,
  OnlineEvaluationConfig,
  type OnlineEvaluationConfigProps,
} from "aws-cdk-lib/aws-bedrockagentcore";
import {
  type IGrantable,
  type IRole,
  PolicyStatement,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import {
  COPY_STATE,
  type Grant,
  GrantQueue,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder, createAlarms } from "@composurecdk/cloudwatch";
import { createRoleBuilder } from "@composurecdk/iam";
import type { AgentCoreMetricSource } from "./alarms.js";
import {
  type OnlineEvaluationAlarmConfig,
  onlineEvaluationMetrics,
  resolveOnlineEvaluationAlarms,
} from "./evaluation-alarms.js";
import { ONLINE_EVALUATION_DEFAULTS } from "./online-evaluation-defaults.js";

/** Configuration properties for {@link createOnlineEvaluationBuilder}. */
export interface OnlineEvaluationBuilderProps extends Omit<
  OnlineEvaluationConfigProps,
  "executionRole" | "evaluators" | "dataSource" | "tags"
> {
  /** @default - a role with no model access */
  executionRole?: Resolvable<NonNullable<OnlineEvaluationConfigProps["executionRole"]>>;

  /** The evaluators to run, e.g. an evaluator builder result's `selector`. Required. */
  evaluators?: Resolvable<OnlineEvaluationConfigProps["evaluators"][number]>[];

  /** The traces to evaluate. Required. */
  dataSource?: Resolvable<OnlineEvaluationConfigProps["dataSource"]>;

  /** Opt-in alarms on evaluation scores. */
  recommendedAlarms?: OnlineEvaluationAlarmConfig;
}

/** The build output of an {@link IOnlineEvaluationBuilder}. */
export interface OnlineEvaluationBuilderResult {
  onlineEvaluation: OnlineEvaluationConfig;
  role: IRole;
  /** The CloudWatch alarms created, keyed by evaluator. */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for an AgentCore online evaluation.
 *
 * @see {@link createOnlineEvaluationBuilder}
 */
export type IOnlineEvaluationBuilder = ITaggedBuilder<
  OnlineEvaluationBuilderProps,
  OnlineEvaluationBuilder
>;

class OnlineEvaluationBuilder implements Lifecycle<OnlineEvaluationBuilderResult> {
  props: Partial<OnlineEvaluationBuilderProps> = {};
  readonly #grants = new GrantQueue<IGrantable>();
  readonly #customAlarms: AlarmDefinitionBuilder<AgentCoreMetricSource>[] = [];

  /** Adds a custom alarm on the evaluation's score metrics, named by evaluator. */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<AgentCoreMetricSource>,
    ) => AlarmDefinitionBuilder<AgentCoreMetricSource>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<AgentCoreMetricSource>(key)));
    return this;
  }

  /** Grants the execution role access to a resource, such as a judge model (ADR-0013). */
  grant(...grants: Grant<IGrantable>[]): this {
    this.#grants.add(...grants);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: OnlineEvaluationBuilder): void {
    this.#grants.copyInto(target.#grants);
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): OnlineEvaluationBuilderResult {
    const {
      onlineEvaluationConfigName,
      executionRole,
      evaluators,
      dataSource: dataSourceRef,
      recommendedAlarms,
      ...rest
    } = this.props;
    if (!onlineEvaluationConfigName || !evaluators?.length || dataSourceRef === undefined) {
      throw new Error(
        `OnlineEvaluationBuilder "${id}" requires an onlineEvaluationConfigName, evaluators ` +
          `and a dataSource.`,
      );
    }
    const dataSource = resolve(dataSourceRef, context);
    const selectors = evaluators.map((e) => resolve(e, context));
    const role =
      executionRole === undefined
        ? buildExecutionRole(scope, id, context, dataSource)
        : resolve(executionRole, context);
    const onlineEvaluation = new OnlineEvaluationConfig(scope, id, {
      ...ONLINE_EVALUATION_DEFAULTS,
      ...rest,
      onlineEvaluationConfigName,
      evaluators: selectors,
      dataSource,
      executionRole: role,
    });
    this.#grants.applyTo(onlineEvaluation, context);
    const metrics = onlineEvaluationMetrics(onlineEvaluation, dataSource);
    const alarms = createAlarms(scope, id, [
      ...resolveOnlineEvaluationAlarms(
        metrics,
        selectors.map((s) => s.evaluatorId),
        recommendedAlarms,
      ),
      ...this.#customAlarms.map((b) => b.resolve(metrics)),
    ]);
    return { onlineEvaluation, role, alarms };
  }
}

/** CDK's execution role, less its model access. */
function buildExecutionRole(
  scope: IConstruct,
  id: string,
  context: Record<string, object>,
  dataSource: DataSourceConfig,
): IRole {
  const stack = Stack.of(scope);
  const logGroupArn = (resourceName: string) =>
    Arn.format(
      {
        service: "logs",
        resource: "log-group",
        resourceName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      },
      stack,
    );
  const logGroup = (name: string) => [logGroupArn(name), logGroupArn(`${name}:*`)];
  const agentCoreArn = (resource: string) =>
    Arn.format({ service: "bedrock-agentcore", resource, resourceName: "*" }, stack);

  return createRoleBuilder()
    .assumedBy(
      new ServicePrincipal("bedrock-agentcore.amazonaws.com", {
        conditions: {
          StringEquals: {
            "aws:SourceAccount": stack.account,
            "aws:ResourceAccount": stack.account,
          },
          ArnLike: {
            "aws:SourceArn": [agentCoreArn("evaluator"), agentCoreArn("online-evaluation-config")],
          },
        },
      }),
    )
    .description("Execution role for Bedrock AgentCore Online Evaluation")
    .addInlinePolicyStatements("Evaluation", [
      new PolicyStatement({
        sid: "CloudWatchLogDescribeStatement",
        actions: EVALUATION_CLOUDWATCH_LOGS_DESCRIBE_PERMS,
        resources: ["*"],
      }),
      new PolicyStatement({
        sid: "CloudWatchLogQueryStatement",
        actions: EVALUATION_CLOUDWATCH_LOGS_QUERY_PERMS,
        resources: [...dataSource.cloudWatchLogsConfig.logGroupNames, "aws/spans"].flatMap(
          logGroup,
        ),
      }),
      new PolicyStatement({
        sid: "CloudWatchLogWriteStatement",
        actions: EVALUATION_CLOUDWATCH_LOGS_WRITE_PERMS,
        resources: [logGroupArn("/aws/bedrock-agentcore/evaluations/*")],
      }),
      new PolicyStatement({
        sid: "CloudWatchIndexPolicyStatement",
        actions: EVALUATION_CLOUDWATCH_INDEX_POLICY_PERMS,
        resources: logGroup("aws/spans"),
      }),
    ])
    .build(scope, `${id}ExecutionRole`, context).role;
}

/**
 * Creates a builder for an AgentCore online evaluation, which scores a
 * sample of an agent's live traces. It is created enabled
 * ({@link ONLINE_EVALUATION_DEFAULTS}).
 *
 * Its execution role has **no model access**: CDK's would allow
 * `bedrock:InvokeModel` on every model in every Region. Grant each custom
 * evaluator's judge with `.grant(modelGrants.invoke(judge))`.
 *
 * Requires CloudWatch Transaction Search in the account, and an agent
 * instrumented with ADOT.
 *
 * @example
 * ```ts
 * createOnlineEvaluationBuilder()
 *   .onlineEvaluationConfigName("support_quality")
 *   .dataSource(ref<RuntimeBuilderResult>("agent").map((r) =>
 *     DataSourceConfig.fromAgentRuntimeEndpoint(r.runtime)))
 *   .evaluators([
 *     EvaluatorSelector.builtin(BuiltinEvaluator.HELPFULNESS),
 *     ref<EvaluatorBuilderResult>("tone").get("selector"),
 *   ])
 *   .grant(modelGrants.invoke(haiku));
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/create-online-evaluations.html
 */
export function createOnlineEvaluationBuilder(): IOnlineEvaluationBuilder {
  return taggedBuilder<OnlineEvaluationBuilderProps, OnlineEvaluationBuilder>(
    OnlineEvaluationBuilder,
  );
}
