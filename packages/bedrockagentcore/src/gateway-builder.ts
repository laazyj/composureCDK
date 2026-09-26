import { Arn, Lazy, Stack } from "aws-cdk-lib";
import {
  type AddLambdaTargetOptions,
  Gateway,
  GATEWAY_KMS_KEY_PERMS,
  type GatewayProps,
  type GatewayTarget,
} from "aws-cdk-lib/aws-bedrockagentcore";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IRole, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createRoleBuilder } from "@composurecdk/iam";
import {
  type AgentCoreMetricSource,
  buildAgentCoreAlarms,
  type GatewayAlarmConfig,
  gatewayAlarmSpecs,
  perMinute,
} from "./alarms.js";
import { GATEWAY_DEFAULTS } from "./gateway-defaults.js";

/** Configuration properties for {@link createGatewayBuilder}. */
export interface GatewayBuilderProps extends Omit<GatewayProps, "role" | "kmsKey" | "tags"> {
  /**
   * The gateway's service role.
   * @default - a role trusted only by gateways in this account
   */
  role?: Resolvable<NonNullable<GatewayProps["role"]>>;

  /**
   * A customer managed key to encrypt the gateway with, as Security Hub
   * BedrockAgentCore.4 asks.
   * @default - an AWS managed key
   */
  kmsKey?: Resolvable<NonNullable<GatewayProps["kmsKey"]>>;

  /**
   * Configuration for the recommended alarms. Set to `false` to disable them;
   * alarms added with `addAlarm()` are unaffected.
   */
  recommendedAlarms?: GatewayAlarmConfig | false;
}

/** A Lambda target, with the function {@link Resolvable}. */
export type GatewayLambdaTargetOptions = Omit<AddLambdaTargetOptions, "lambdaFunction"> & {
  lambdaFunction: Resolvable<AddLambdaTargetOptions["lambdaFunction"]>;
};

/** The build output of an {@link IGatewayBuilder}. */
export interface GatewayBuilderResult {
  gateway: Gateway;
  /** Targets added with `addLambdaTarget()` or `addTarget()`, keyed by key. */
  targets: Record<string, GatewayTarget>;
  /** The CloudWatch alarms created, keyed by alarm key. */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for an Amazon Bedrock AgentCore gateway.
 *
 * @see {@link createGatewayBuilder}
 */
export type IGatewayBuilder = ITaggedBuilder<GatewayBuilderProps, GatewayBuilder>;

/** Adds a target to the gateway, using `key` as its construct id. */
export type GatewayTargetFactory = (
  gateway: Gateway,
  key: string,
  context: Record<string, object>,
) => GatewayTarget;

class GatewayBuilder implements Lifecycle<GatewayBuilderResult> {
  props: Partial<GatewayBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<AgentCoreMetricSource>[] = [];
  readonly #targets = new Map<string, GatewayTargetFactory>();

  /**
   * Adds a Lambda target; the function may come from a sibling via `ref(...)`.
   * Its tools are named `<key>___<tool>` unless `gatewayTargetName` is set.
   */
  addLambdaTarget(key: string, options: GatewayLambdaTargetOptions): this {
    return this.addTarget(key, (gateway, id, context) =>
      gateway.addLambdaTarget(id, {
        gatewayTargetName: key,
        ...options,
        lambdaFunction: resolve(options.lambdaFunction, context),
      }),
    );
  }

  /**
   * Adds any other target, e.g.
   * `(gateway, key) => gateway.addMcpServerTarget(key, { gatewayTargetName: key, … })`.
   */
  addTarget(key: string, factory: GatewayTargetFactory): this {
    if (this.#targets.has(key)) {
      throw new Error(`GatewayBuilder.addTarget: duplicate key "${key}".`);
    }
    this.#targets.set(key, factory);
    return this;
  }

  /** Adds a custom alarm on the gateway's metrics. */
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
  [COPY_STATE](target: GatewayBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
    for (const [key, factory] of this.#targets) target.#targets.set(key, factory);
  }

  build(scope: IConstruct, id: string, context: Record<string, object> = {}): GatewayBuilderResult {
    const { role: roleRef, kmsKey: kmsKeyRef, recommendedAlarms, ...rest } = this.props;
    const kmsKey = kmsKeyRef && resolve(kmsKeyRef, context);
    const role: IRole =
      roleRef === undefined
        ? // Resolved at synth, once the gateway has its name.
          buildServiceRole(scope, id, context, (): string => gateway.gatewayName)
        : resolve(roleRef, context);
    // CDK grants these only to the role it creates.
    kmsKey?.grant(role, ...GATEWAY_KMS_KEY_PERMS);

    const gateway: Gateway = new Gateway(scope, id, {
      ...GATEWAY_DEFAULTS,
      ...rest,
      role,
      ...(kmsKey && { kmsKey }),
    });
    const targets = Object.fromEntries(
      [...this.#targets].map(([key, factory]) => [key, factory(gateway, key, context)]),
    );
    const alarms = buildAgentCoreAlarms(
      scope,
      id,
      gatewayMetrics(gateway),
      gatewayAlarmSpecs(`AgentCore gateway ${gateway.gatewayName}`),
      recommendedAlarms,
      this.#customAlarms,
    );
    return { gateway, targets, alarms };
  }
}

/** A gateway's invocation metrics, with dimensions set here rather than by CDK's release. */
function gatewayMetrics(gateway: Gateway): AgentCoreMetricSource {
  return perMinute({
    metric: (metricName, options) =>
      gateway.metric(metricName, {
        ...options,
        dimensionsMap: {
          Operation: "InvokeGateway",
          Protocol: gateway.protocolConfiguration.protocolType,
          Resource: gateway.gatewayArn,
          ...options?.dimensionsMap,
        },
      }),
  });
}

/** A service role the service can assume only on behalf of this gateway. */
function buildServiceRole(
  scope: IConstruct,
  id: string,
  context: Record<string, object>,
  gatewayName: () => string,
): IRole {
  const stack = Stack.of(scope);
  const principal = new ServicePrincipal("bedrock-agentcore.amazonaws.com", {
    conditions: {
      StringEquals: { "aws:SourceAccount": stack.account },
      ArnLike: {
        "aws:SourceArn": Arn.format(
          {
            service: "bedrock-agentcore",
            resource: "gateway",
            resourceName: `${Lazy.string({ produce: gatewayName })}*`,
          },
          stack,
        ),
      },
    },
  });
  return createRoleBuilder().assumedBy(principal).build(scope, `${id}ServiceRole`, context).role;
}

/**
 * Creates a builder for an Amazon Bedrock AgentCore gateway, with IAM inbound
 * auth ({@link GATEWAY_DEFAULTS}) and a service role trusted only for this
 * gateway. Grant callers with {@link gatewayGrants}.
 *
 * @example
 * ```ts
 * createGatewayBuilder()
 *   .gatewayName("support-tools")
 *   .addLambdaTarget("orders", {
 *     lambdaFunction: ref<FunctionBuilderResult>("orders").get("function"),
 *     toolSchema: ToolSchema.fromLocalAsset("tools/orders.json"),
 *   });
 * ```
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html
 */
export function createGatewayBuilder(): IGatewayBuilder {
  return taggedBuilder<GatewayBuilderProps, GatewayBuilder>(GatewayBuilder);
}
