import {
  type IBedrockAgentRuntime,
  RuntimeEndpoint,
  type RuntimeEndpointProps,
} from "aws-cdk-lib/aws-bedrockagentcore";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type ILogGroup, LogGroup, LogRetention } from "aws-cdk-lib/aws-logs";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { LOG_GROUP_DEFAULTS } from "@composurecdk/logs";
import {
  type AgentCoreAlarmConfig,
  type AgentCoreMetricSource,
  buildAgentCoreAlarms,
  perMinute,
  runtimeAlarmSpecs,
} from "./alarms.js";

/** The endpoint every runtime has, used when a caller names no qualifier. @internal */
export const DEFAULT_ENDPOINT_NAME = "DEFAULT";

/** A runtime endpoint's log group and alarms. */
export interface RuntimeEndpointObservability {
  /**
   * The endpoint's runtime log group, created by the service. Make anything
   * built on it depend on {@link logRetention}, which runs once it exists.
   */
  logGroup: ILogGroup;
  /** Sets the `@composurecdk/logs` default retention on {@link logGroup}. */
  logRetention: LogRetention;
  /** The CloudWatch alarms created, keyed by alarm key. */
  alarms: Record<string, Alarm>;
}

/**
 * `AWS/Bedrock-AgentCore` metrics for one endpoint of a runtime. The
 * dimensions are set here rather than taken from CDK, whose defaults vary by
 * release.
 */
export function runtimeEndpointMetrics(
  runtime: IBedrockAgentRuntime,
  endpointName: string,
): AgentCoreMetricSource {
  return perMinute({
    metric: (metricName, options) =>
      runtime.metric(metricName, {
        ...options,
        dimensionsMap: {
          Operation: "InvokeAgentRuntime",
          Name: `${runtime.agentRuntimeName}::${endpointName}`,
          Resource: runtime.agentRuntimeArn,
          ...options?.dimensionsMap,
        },
      }),
  });
}

/**
 * Sets retention on an endpoint's log group and creates its alarms. `endpoint`
 * is the construct whose creation makes the service create the log group.
 * @internal
 */
export function buildEndpointObservability(
  scope: IConstruct,
  id: string,
  runtime: IBedrockAgentRuntime,
  endpointName: string,
  alarmConfig: AgentCoreAlarmConfig | false | undefined,
  endpoint: IConstruct,
  customAlarms: AlarmDefinitionBuilder<AgentCoreMetricSource>[] = [],
): RuntimeEndpointObservability {
  const logGroupName = `/aws/bedrock-agentcore/runtimes/${runtime.agentRuntimeId}-${endpointName}`;
  const logRetention = new LogRetention(scope, `${id}LogRetention`, {
    logGroupName,
    removalPolicy: LOG_GROUP_DEFAULTS.removalPolicy,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- LOG_GROUP_DEFAULTS always sets it
    retention: LOG_GROUP_DEFAULTS.retention!,
  });
  logRetention.node.addDependency(endpoint);
  const logGroup = LogGroup.fromLogGroupName(scope, `${id}LogGroup`, logGroupName);
  const subject = `AgentCore runtime endpoint ${runtime.agentRuntimeName}::${endpointName}`;
  const alarms = buildAgentCoreAlarms(
    scope,
    id,
    runtimeEndpointMetrics(runtime, endpointName),
    runtimeAlarmSpecs(subject),
    alarmConfig,
    customAlarms,
  );
  return { logGroup, logRetention, alarms };
}

/** Configuration properties for {@link createRuntimeEndpointBuilder}. */
export interface RuntimeEndpointBuilderProps extends Omit<
  RuntimeEndpointProps,
  "agentRuntimeId" | "tags"
> {
  /** The runtime to add the endpoint to. Required. */
  runtime: Resolvable<IBedrockAgentRuntime>;

  /**
   * Configuration for the recommended alarms. Set to `false` to disable them;
   * alarms added with `addAlarm()` are unaffected.
   */
  recommendedAlarms?: AgentCoreAlarmConfig | false;
}

/** The build output of an {@link IRuntimeEndpointBuilder}. */
export interface RuntimeEndpointBuilderResult extends RuntimeEndpointObservability {
  endpoint: RuntimeEndpoint;
}

/**
 * A fluent builder for an endpoint on an AgentCore runtime.
 *
 * @see {@link createRuntimeEndpointBuilder}
 */
export type IRuntimeEndpointBuilder = ITaggedBuilder<
  RuntimeEndpointBuilderProps,
  RuntimeEndpointBuilder
>;

class RuntimeEndpointBuilder implements Lifecycle<RuntimeEndpointBuilderResult> {
  props: Partial<RuntimeEndpointBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<AgentCoreMetricSource>[] = [];

  /** Adds a custom alarm on the endpoint's metrics. */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<AgentCoreMetricSource>,
    ) => AlarmDefinitionBuilder<AgentCoreMetricSource>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<AgentCoreMetricSource>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: RuntimeEndpointBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): RuntimeEndpointBuilderResult {
    const { runtime: runtimeRef, recommendedAlarms, ...rest } = this.props;
    if (runtimeRef === undefined || !rest.endpointName) {
      throw new Error(
        `RuntimeEndpointBuilder "${id}" requires a runtime and an endpointName. ` +
          `Call .runtime() and .endpointName().`,
      );
    }
    const runtime = resolve(runtimeRef, context);
    const endpoint = new RuntimeEndpoint(scope, id, {
      ...rest,
      agentRuntimeId: runtime.agentRuntimeId,
    });
    return {
      endpoint,
      ...buildEndpointObservability(
        scope,
        id,
        runtime,
        rest.endpointName,
        recommendedAlarms,
        endpoint,
        this.#customAlarms,
      ),
    };
  }
}

/**
 * Creates a builder for an endpoint on a runtime this system does not build,
 * e.g. one pinned to a version for promotion. For a runtime built by
 * {@link createRuntimeBuilder}, use its `addEndpoint()` instead.
 *
 * The endpoint gets its own runtime log group and recommended alarms.
 *
 * @example
 * ```ts
 * createRuntimeEndpointBuilder()
 *   .runtime(Runtime.fromAgentRuntimeAttributes(stack, "Agent", attrs))
 *   .endpointName("prod")
 *   .agentRuntimeVersion("3");
 * ```
 */
export function createRuntimeEndpointBuilder(): IRuntimeEndpointBuilder {
  return taggedBuilder<RuntimeEndpointBuilderProps, RuntimeEndpointBuilder>(RuntimeEndpointBuilder);
}
