import type { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import {
  type CodeBasedOptions,
  Evaluator,
  EvaluatorConfig,
  type EvaluatorProps,
  EvaluatorSelector,
  type LlmAsAJudgeOptions,
} from "aws-cdk-lib/aws-bedrockagentcore";
import type { IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import type { InferenceProfile } from "@composurecdk/bedrock";

/** A model an LLM-as-a-judge evaluator can call. */
export type JudgeModel = FoundationModelIdentifier | InferenceProfile;

/** An LLM-as-a-judge evaluator, with its model as a `@composurecdk/bedrock` target. */
export type LlmAsAJudgeEvaluatorOptions = Omit<LlmAsAJudgeOptions, "modelId"> & {
  model: JudgeModel;
};

/** A code-based evaluator, with its function {@link Resolvable}. */
export type CodeBasedEvaluatorOptions = Omit<CodeBasedOptions, "lambdaFunction"> & {
  lambdaFunction: Resolvable<CodeBasedOptions["lambdaFunction"]>;
};

/**
 * Configuration properties for {@link createEvaluatorBuilder}. Set exactly
 * one of `llmAsAJudge`, `codeBased` or `evaluatorConfig`.
 */
export interface EvaluatorBuilderProps extends Omit<EvaluatorProps, "evaluatorConfig" | "tags"> {
  llmAsAJudge?: LlmAsAJudgeEvaluatorOptions;
  codeBased?: CodeBasedEvaluatorOptions;
  evaluatorConfig?: EvaluatorProps["evaluatorConfig"];
}

/** The build output of an {@link IEvaluatorBuilder}. */
export interface EvaluatorBuilderResult {
  evaluator: Evaluator;
  /** The evaluator, for an online evaluation's `evaluators`. */
  selector: EvaluatorSelector;
  /** The model an LLM-as-a-judge evaluator calls, for the online evaluation to grant. */
  judge?: JudgeModel;
}

/**
 * A fluent builder for a custom AgentCore evaluator.
 *
 * @see {@link createEvaluatorBuilder}
 */
export type IEvaluatorBuilder = ITaggedBuilder<EvaluatorBuilderProps, EvaluatorBuilder>;

class EvaluatorBuilder implements Lifecycle<EvaluatorBuilderResult> {
  props: Partial<EvaluatorBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): EvaluatorBuilderResult {
    const { llmAsAJudge, codeBased, evaluatorConfig, evaluatorName, level, ...rest } = this.props;
    const count = [llmAsAJudge, codeBased, evaluatorConfig].filter((c) => c !== undefined).length;
    const config = llmAsAJudge
      ? EvaluatorConfig.llmAsAJudge({ ...llmAsAJudge, modelId: modelIdOf(llmAsAJudge.model) })
      : codeBased
        ? EvaluatorConfig.codeBased({
            ...codeBased,
            lambdaFunction: resolve(codeBased.lambdaFunction, context),
          })
        : evaluatorConfig;
    if (!evaluatorName || !level || !config || count !== 1) {
      throw new Error(
        `EvaluatorBuilder "${id}" requires an evaluatorName, a level and exactly one of ` +
          `.llmAsAJudge(), .codeBased() or .evaluatorConfig().`,
      );
    }
    const evaluator = new Evaluator(scope, id, {
      ...rest,
      evaluatorName,
      level,
      evaluatorConfig: config,
    });
    return {
      evaluator,
      selector: EvaluatorSelector.custom(evaluator),
      judge: llmAsAJudge?.model,
    };
  }
}

function modelIdOf(model: JudgeModel): string {
  return "profileId" in model ? model.profileId : model.modelId;
}

/**
 * Creates a builder for a custom AgentCore evaluator. Built-in evaluators are
 * not resources; select them with `EvaluatorSelector.builtin(...)`.
 *
 * An LLM-as-a-judge evaluator takes its model as a `@composurecdk/bedrock`
 * target, and returns it as `judge` for the online evaluation to grant.
 *
 * @example
 * ```ts
 * createEvaluatorBuilder()
 *   .evaluatorName("tone")
 *   .level(EvaluationLevel.TRACE)
 *   .llmAsAJudge({ model: haiku, instructions, ratingScale });
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/custom-evaluators.html
 */
export function createEvaluatorBuilder(): IEvaluatorBuilder {
  return taggedBuilder<EvaluatorBuilderProps, EvaluatorBuilder>(EvaluatorBuilder);
}
