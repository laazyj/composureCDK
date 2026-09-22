import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder, createAlarms } from "@composurecdk/cloudwatch";
import type { ModelAlarmConfig } from "./model-alarm-config.js";
import {
  type ModelAlarmTarget,
  type ModelMetrics,
  modelMetrics,
  resolveModelAlarmDefinitions,
} from "./model-alarms.js";

/** Configuration properties for {@link createModelAlarmBuilder}. */
export interface ModelAlarmBuilderProps {
  /** The foundation model or inference profile to alarm on. Required. */
  model: Resolvable<ModelAlarmTarget>;

  /**
   * Configuration for the recommended alarms. Throttle, server-error and
   * client-error alarms are created by default; latency, time-to-first-token
   * and quota alarms are opt-in. Set to `false` to disable them; alarms added
   * with `addAlarm()` are unaffected.
   *
   * No alarm actions are configured. Use `alarmActionsPolicy` or an
   * `afterBuild` hook to route them.
   */
  recommendedAlarms?: ModelAlarmConfig | false;
}

/** The build output of an {@link IModelAlarmBuilder}. */
export interface ModelAlarmBuilderResult {
  /** The CloudWatch alarms created, keyed by alarm key. */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for CloudWatch alarms on an Amazon Bedrock model.
 *
 * @see {@link createModelAlarmBuilder}
 */
export type IModelAlarmBuilder = ITaggedBuilder<ModelAlarmBuilderProps, ModelAlarmBuilder>;

class ModelAlarmBuilder implements Lifecycle<ModelAlarmBuilderResult> {
  props: Partial<ModelAlarmBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<ModelMetrics>[] = [];

  /**
   * Adds a custom alarm. The metric factory receives the model's
   * {@link ModelMetrics}, e.g.
   * `(a) => a.metric((m) => m.metric("OutputTokenCount", { statistic: "Sum" })).threshold(1e6)`.
   */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<ModelMetrics>,
    ) => AlarmDefinitionBuilder<ModelMetrics>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<ModelMetrics>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ModelAlarmBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): ModelAlarmBuilderResult {
    if (this.props.model === undefined) {
      throw new Error(`ModelAlarmBuilder "${id}" requires a model. Call .model().`);
    }
    const metrics = modelMetrics(resolve(this.props.model, context));
    const { recommendedAlarms } = this.props;
    const recommended =
      recommendedAlarms === false
        ? []
        : resolveModelAlarmDefinitions(scope, metrics, recommendedAlarms);
    const custom = this.#customAlarms.map((b) => b.resolve(metrics));
    return { alarms: createAlarms(scope, id, [...recommended, ...custom]) };
  }
}

/**
 * Creates CloudWatch alarms on an Amazon Bedrock model's `AWS/Bedrock`
 * metrics.
 *
 * The metrics are per model per account and Region, whichever principal
 * invokes it, so build one per model in each Region that invokes it rather
 * than one per caller. For a cross-Region profile, the metrics are emitted
 * in the source Region.
 *
 * @example
 * ```ts
 * createModelAlarmBuilder()
 *   .model(haiku)
 *   .recommendedAlarms({ invocationLatency: { threshold: 10_000 } });
 * ```
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/genops02-bp02.html
 */
export function createModelAlarmBuilder(): IModelAlarmBuilder {
  return taggedBuilder<ModelAlarmBuilderProps, ModelAlarmBuilder>(ModelAlarmBuilder);
}
