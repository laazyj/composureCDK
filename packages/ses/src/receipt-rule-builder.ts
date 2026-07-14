import { type IReceiptRuleAction, type ReceiptRuleOptions } from "aws-cdk-lib/aws-ses";
import { Builder, COPY_STATE, type IBuilder, resolve, type Resolvable } from "@composurecdk/core";
import { DEFAULT_RECEIPT_RULE } from "./defaults.js";

/**
 * Configuration for a single receipt rule. `actions` and `after` are owned by
 * the builder — actions via {@link IReceiptRuleBuilder.addAction}, ordering via
 * the sequence in which rules are declared on the rule set.
 */
export type ReceiptRuleBuilderProps = Omit<ReceiptRuleOptions, "actions" | "after">;

interface ActionEntry {
  key: string;
  action: Resolvable<IReceiptRuleAction>;
}

class ReceiptRuleBuilder {
  props: Partial<ReceiptRuleBuilderProps> = {};
  readonly #actions: ActionEntry[] = [];

  /**
   * Register an action to run on matching mail, in declaration order. Accepts a
   * concrete action or a {@link Resolvable} — the action helpers (`s3Action`,
   * `lambdaAction`, …) produce these, wiring sibling components via `ref()`.
   */
  addAction(key: string, action: Resolvable<IReceiptRuleAction>): this {
    if (this.#actions.some((a) => a.key === key)) {
      throw new Error(
        `ReceiptRuleBuilder.addAction: duplicate key "${key}". Each action must use a unique key.`,
      );
    }
    this.#actions.push({ key, action });
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ReceiptRuleBuilder): void {
    target.#actions.push(...this.#actions);
  }

  /** @internal — resolves actions and merges secure defaults into rule options. */
  toOptions(context: Record<string, object>): ReceiptRuleOptions {
    const actions = this.#actions.map((a) => resolve(a.action, context));
    return {
      ...DEFAULT_RECEIPT_RULE,
      ...this.props,
      ...(actions.length > 0 && { actions }),
    };
  }
}

/**
 * Fluent configuration surface for a receipt rule, passed to the callback of
 * {@link IReceiptRuleSetBuilder.rule}.
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ReceiptRule has no Tags property
type FullReceiptRuleBuilder = IBuilder<ReceiptRuleBuilderProps, ReceiptRuleBuilder>;

export type IReceiptRuleBuilder = Omit<FullReceiptRuleBuilder, "toOptions">;

/** @internal — the rule-set builder instantiates this to gather rule options. */
export function createReceiptRuleBuilder(): FullReceiptRuleBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ReceiptRule has no Tags property
  return Builder<ReceiptRuleBuilderProps, ReceiptRuleBuilder>(ReceiptRuleBuilder);
}
