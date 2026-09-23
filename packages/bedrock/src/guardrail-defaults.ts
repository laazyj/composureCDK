import type { CfnGuardrailProps } from "aws-cdk-lib/aws-bedrock";

const HARMFUL_CONTENT = ["SEXUAL", "VIOLENCE", "HATE", "INSULTS", "MISCONDUCT"];

/** The Bedrock console's default message for a blocked prompt or response. */
const BLOCKED_MESSAGE = "Sorry, the model cannot answer this question.";

/**
 * Defaults for {@link createGuardrailBuilder}.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec02-bp01.html
 */
export const GUARDRAIL_DEFAULTS = {
  blockedInputMessaging: BLOCKED_MESSAGE,
  blockedOutputsMessaging: BLOCKED_MESSAGE,

  /**
   * Every harmful-content category and prompt attacks, at `HIGH`. AWS
   * recommends no strengths; `HIGH` blocks the most, and a category that
   * blocks legitimate content can be lowered. Prompt attacks only apply to
   * input, so their output strength must be `NONE`.
   *
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-content-filters.html
   */
  contentPolicyConfig: {
    filtersConfig: [
      ...HARMFUL_CONTENT.map((type) => ({ type, inputStrength: "HIGH", outputStrength: "HIGH" })),
      { type: "PROMPT_ATTACK", inputStrength: "HIGH", outputStrength: "NONE" },
    ],
  },
} satisfies Partial<CfnGuardrailProps>;
