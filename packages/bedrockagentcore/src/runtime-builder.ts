import {
  type AddEndpointOptions,
  Runtime,
  RuntimeNetworkConfiguration,
  type RuntimeProps,
  type VpcConfigProps,
} from "aws-cdk-lib/aws-bedrockagentcore";
import { Peer, Port, type SecurityGroup } from "aws-cdk-lib/aws-ec2";
import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
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
import { createSecurityGroupBuilder } from "@composurecdk/ec2";
import type { AgentCoreAlarmConfig, AgentCoreMetricSource } from "./alarms.js";
import { RUNTIME_DEFAULTS } from "./runtime-defaults.js";
import {
  buildEndpointObservability,
  DEFAULT_ENDPOINT_NAME,
  type RuntimeEndpointBuilderResult,
  type RuntimeEndpointObservability,
} from "./runtime-endpoint.js";

/** Configuration properties for {@link createRuntimeBuilder}. */
export interface RuntimeBuilderProps extends Omit<
  RuntimeProps,
  "executionRole" | "environmentVariables" | "tags"
> {
  executionRole?: Resolvable<NonNullable<RuntimeProps["executionRole"]>>;

  environmentVariables?: Record<
    string,
    Resolvable<NonNullable<RuntimeProps["environmentVariables"]>[string]>
  >;

  /** Runs the runtime in this VPC. Mutually exclusive with `networkConfiguration`. */
  vpc?: Resolvable<VpcConfigProps["vpc"]>;

  /** The subnets to use with {@link vpc}. */
  vpcSubnets?: VpcConfigProps["vpcSubnets"];

  /**
   * Security groups to use with {@link vpc}.
   * @default - a new security group allowing only outbound HTTPS
   */
  securityGroups?: Resolvable<NonNullable<VpcConfigProps["securityGroups"]>>;

  /**
   * Configuration for the recommended alarms, created for each endpoint. Set
   * to `false` to disable them; alarms added with `addAlarm()` are unaffected.
   */
  recommendedAlarms?: AgentCoreAlarmConfig | false;
}

/** The build output of an {@link IRuntimeBuilder}. */
export interface RuntimeBuilderResult extends RuntimeEndpointObservability {
  runtime: Runtime;
  /** The security group created for a VPC runtime given none. */
  securityGroup?: SecurityGroup;
  /** Endpoints added with `addEndpoint()`, keyed by endpoint name. */
  endpoints: Record<string, RuntimeEndpointBuilderResult>;
}

/**
 * A fluent builder for an Amazon Bedrock AgentCore runtime.
 *
 * @see {@link createRuntimeBuilder}
 */
export type IRuntimeBuilder = ITaggedBuilder<RuntimeBuilderProps, RuntimeBuilder>;

class RuntimeBuilder implements Lifecycle<RuntimeBuilderResult> {
  props: Partial<RuntimeBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<AgentCoreMetricSource>[] = [];
  readonly #endpoints = new Map<string, AddEndpointOptions | undefined>();
  readonly #grants = new GrantQueue<IGrantable>();

  /**
   * Adds an endpoint, e.g. one pinned to a version for promotion. It gets its
   * own log group and recommended alarms.
   */
  addEndpoint(endpointName: string, options?: AddEndpointOptions): this {
    if (endpointName === DEFAULT_ENDPOINT_NAME || this.#endpoints.has(endpointName)) {
      throw new Error(`RuntimeBuilder.addEndpoint: "${endpointName}" is already an endpoint.`);
    }
    this.#endpoints.set(endpointName, options);
    return this;
  }

  /** Adds a custom alarm on the `DEFAULT` endpoint's metrics. */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<AgentCoreMetricSource>,
    ) => AlarmDefinitionBuilder<AgentCoreMetricSource>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<AgentCoreMetricSource>(key)));
    return this;
  }

  /**
   * Grants the runtime's execution role access to a resource, e.g.
   * `modelGrants.invoke(profile)` from `@composurecdk/bedrock` (ADR-0013).
   */
  grant(...grants: Grant<IGrantable>[]): this {
    this.#grants.add(...grants);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: RuntimeBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
    for (const [name, options] of this.#endpoints) target.#endpoints.set(name, options);
    this.#grants.copyInto(target.#grants);
  }

  build(scope: IConstruct, id: string, context: Record<string, object> = {}): RuntimeBuilderResult {
    const {
      agentRuntimeArtifact,
      executionRole,
      environmentVariables,
      vpc,
      vpcSubnets,
      securityGroups,
      networkConfiguration,
      recommendedAlarms,
      ...rest
    } = this.props;
    if (!agentRuntimeArtifact) {
      throw new Error(
        `RuntimeBuilder "${id}" requires an agentRuntimeArtifact. Call .agentRuntimeArtifact().`,
      );
    }
    if (vpc !== undefined && networkConfiguration !== undefined) {
      throw new Error(`RuntimeBuilder "${id}": .vpc() and .networkConfiguration() are exclusive.`);
    }
    if (vpc === undefined && networkConfiguration === undefined) {
      throw new Error(
        `RuntimeBuilder "${id}" requires a network. Call .vpc() to run in your VPC, or ` +
          `.networkConfiguration(RuntimeNetworkConfiguration.usingPublicNetwork()) to accept ` +
          `public networking (Security Hub BedrockAgentCore.1).`,
      );
    }

    const resolvedVpc = vpc && resolve(vpc, context);
    const suppliedGroups = securityGroups && resolve(securityGroups, context);
    const securityGroup =
      resolvedVpc && !suppliedGroups
        ? createSecurityGroupBuilder()
            .vpc(resolvedVpc)
            .description(`AgentCore runtime ${id}`)
            .addEgressRule(Peer.anyIpv4(), Port.tcp(443), "HTTPS to AWS and model endpoints")
            .build(scope, `${id}Sg`, context).securityGroup
        : undefined;

    const runtime = new Runtime(scope, id, {
      ...RUNTIME_DEFAULTS,
      ...rest,
      agentRuntimeArtifact,
      networkConfiguration: resolvedVpc
        ? RuntimeNetworkConfiguration.usingVpc(scope, {
            vpc: resolvedVpc,
            vpcSubnets,
            securityGroups: suppliedGroups ?? (securityGroup && [securityGroup]),
          })
        : networkConfiguration,
      ...(executionRole !== undefined && { executionRole: resolve(executionRole, context) }),
      ...(environmentVariables !== undefined && {
        environmentVariables: resolve(combine(environmentVariables), context),
      }),
    });
    this.#grants.applyTo(runtime, context);

    const endpoints: Record<string, RuntimeEndpointBuilderResult> = {};
    for (const [name, options] of this.#endpoints) {
      const endpoint = runtime.addEndpoint(name, options);
      endpoints[name] = {
        endpoint,
        ...buildEndpointObservability(
          scope,
          `${id}${name}`,
          runtime,
          name,
          recommendedAlarms,
          endpoint,
        ),
      };
    }

    return {
      runtime,
      securityGroup,
      ...buildEndpointObservability(
        scope,
        id,
        runtime,
        DEFAULT_ENDPOINT_NAME,
        recommendedAlarms,
        runtime,
        this.#customAlarms,
      ),
      endpoints,
    };
  }
}

/**
 * Creates a builder for an Amazon Bedrock AgentCore runtime.
 *
 * - **Network is required.** Call `.vpc()`, or pass
 *   `RuntimeNetworkConfiguration.usingPublicNetwork()` to accept public
 *   networking, which fails Security Hub control BedrockAgentCore.1.
 * - **Tracing is on** ({@link RUNTIME_DEFAULTS}).
 * - **Log retention** is set on each endpoint's log group, which the service
 *   creates without one.
 * - **Model access is a grant:** `.grant(modelGrants.invoke(profile))`. CDK's
 *   execution role covers only what the runtime needs to start.
 *
 * @example
 * ```ts
 * createRuntimeBuilder()
 *   .runtimeName("support_agent")
 *   .agentRuntimeArtifact(AgentRuntimeArtifact.fromCodeAsset({ path: "agent", runtime, entrypoint }))
 *   .vpc(ref<VpcBuilderResult>("network").get("vpc"))
 *   .environmentVariables({ MODEL_ID: haiku.profileId })
 *   .grant(modelGrants.invoke(haiku))
 *   .addEndpoint("prod", { version: "1" });
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html
 */
export function createRuntimeBuilder(): IRuntimeBuilder {
  return taggedBuilder<RuntimeBuilderProps, RuntimeBuilder>(RuntimeBuilder);
}
