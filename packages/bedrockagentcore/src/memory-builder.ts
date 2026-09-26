import { Memory, type MemoryProps } from "aws-cdk-lib/aws-bedrockagentcore";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder, createAlarms } from "@composurecdk/cloudwatch";
import { type AgentCoreMetricSource, perMinute } from "./alarms.js";

/** Configuration properties for {@link createMemoryBuilder}. */
export interface MemoryBuilderProps extends Omit<MemoryProps, "kmsKey" | "executionRole" | "tags"> {
  /**
   * A customer managed key to encrypt the memory with, as Security Hub
   * BedrockAgentCore.3 asks.
   * @default - an AWS owned key
   */
  kmsKey?: Resolvable<NonNullable<MemoryProps["kmsKey"]>>;

  executionRole?: Resolvable<NonNullable<MemoryProps["executionRole"]>>;
}

/** The build output of an {@link IMemoryBuilder}. */
export interface MemoryBuilderResult {
  memory: Memory;
  /** The CloudWatch alarms created, keyed by alarm key. */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for an Amazon Bedrock AgentCore memory.
 *
 * @see {@link createMemoryBuilder}
 */
export type IMemoryBuilder = ITaggedBuilder<MemoryBuilderProps, MemoryBuilder>;

class MemoryBuilder implements Lifecycle<MemoryBuilderResult> {
  props: Partial<MemoryBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<AgentCoreMetricSource>[] = [];

  /**
   * Adds a custom alarm. AgentCore publishes memory metrics per API operation,
   * so pass one, e.g.
   * `m.metric("Errors", { dimensionsMap: { Operation: "CreateEvent" } })`.
   */
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
  [COPY_STATE](target: MemoryBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string, context: Record<string, object> = {}): MemoryBuilderResult {
    const { kmsKey, executionRole, ...rest } = this.props;
    const memory = new Memory(scope, id, {
      ...rest,
      ...(kmsKey !== undefined && { kmsKey: resolve(kmsKey, context) }),
      ...(executionRole !== undefined && { executionRole: resolve(executionRole, context) }),
    });
    const metrics = perMinute(memory);
    const alarms = createAlarms(
      scope,
      id,
      this.#customAlarms.map((b) => b.resolve(metrics)),
    );
    return { memory, alarms };
  }
}

/**
 * Creates a builder for an Amazon Bedrock AgentCore memory, keeping CDK's
 * defaults. Grant agents access with {@link memoryGrants}.
 *
 * @example
 * ```ts
 * createMemoryBuilder()
 *   .memoryName("support_memory")
 *   .memoryStrategies([MemoryStrategy.usingBuiltInSummarization()]);
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html
 */
export function createMemoryBuilder(): IMemoryBuilder {
  return taggedBuilder<MemoryBuilderProps, MemoryBuilder>(MemoryBuilder);
}
