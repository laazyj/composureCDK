import { type CustomResource } from "aws-cdk-lib";
import { type ReceiptRule, ReceiptRuleSet, type ReceiptRuleSetProps } from "aws-cdk-lib/aws-ses";
import { type IConstruct } from "constructs";
import {
  Builder,
  COPY_STATE,
  constructId,
  type IBuilder,
  type Lifecycle,
} from "@composurecdk/core";
import { activateReceiptRuleSet } from "./activation.js";
import { createReceiptRuleBuilder, type IReceiptRuleBuilder } from "./receipt-rule-builder.js";
import { warnIfNotReceivingRegion } from "./region-support.js";

/**
 * Configuration for the receipt rule set builder. `rules` is owned by the
 * builder's {@link IReceiptRuleSetBuilder.rule} method; `dropSpam` and
 * `receiptRuleSetName` pass through from {@link ReceiptRuleSetProps}.
 */
export type ReceiptRuleSetBuilderProps = Omit<ReceiptRuleSetProps, "rules">;

/** The build output of an {@link IReceiptRuleSetBuilder}. */
export interface ReceiptRuleSetBuilderResult {
  /** The receipt rule set construct. */
  ruleSet: ReceiptRuleSet;
  /** Rules added via {@link IReceiptRuleSetBuilder.rule}, keyed and in order. */
  rules: Record<string, ReceiptRule>;
  /**
   * The activation custom resource. Present unless activation was disabled with
   * `.activate(false)`.
   */
  activation?: CustomResource;
}

interface RuleEntry {
  key: string;
  configure: (rule: IReceiptRuleBuilder) => IReceiptRuleBuilder;
}

/**
 * A fluent builder for an SES receipt rule set. Rules are declared with
 * `.rule()` and run in declaration order. By default the rule set is made the
 * account's active rule set (opt out with `.activate(false)`) — a rule set is
 * inert until active, so this is on by default.
 *
 * @example
 * ```ts
 * const { ruleSet } = createReceiptRuleSetBuilder()
 *   .rule("inbound", (r) =>
 *     r.recipients(["info@example.com"]).addAction("store", s3Action(bucket)))
 *   .build(stack, "MailRuleSet");
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ReceiptRuleSet has no Tags property
export type IReceiptRuleSetBuilder = IBuilder<ReceiptRuleSetBuilderProps, ReceiptRuleSetBuilder>;

class ReceiptRuleSetBuilder implements Lifecycle<ReceiptRuleSetBuilderResult> {
  props: Partial<ReceiptRuleSetBuilderProps> = {};
  readonly #rules: RuleEntry[] = [];
  // Opt-out: an inactive rule set silently drops mail, so activate by default.
  #activate = true;

  /**
   * Declare a rule. The callback configures recipients, scanning, TLS policy,
   * and actions. Rules run in the order declared.
   */
  rule(key: string, configure: (rule: IReceiptRuleBuilder) => IReceiptRuleBuilder): this {
    if (this.#rules.some((r) => r.key === key)) {
      throw new Error(
        `ReceiptRuleSetBuilder.rule: duplicate key "${key}". Each rule must use a unique key.`,
      );
    }
    this.#rules.push({ key, configure });
    return this;
  }

  /** Whether to make this the account's active rule set. On by default. */
  activate(enabled: boolean): this {
    this.#activate = enabled;
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ReceiptRuleSetBuilder): void {
    target.#rules.push(...this.#rules);
    target.#activate = this.#activate;
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): ReceiptRuleSetBuilderResult {
    warnIfNotReceivingRegion(scope);
    const ruleSet = new ReceiptRuleSet(scope, id, { ...this.props });

    const rules: Record<string, ReceiptRule> = {};
    for (const entry of this.#rules) {
      const builder = createReceiptRuleBuilder();
      entry.configure(builder);
      // addRule chains each rule after the previous one, preserving order.
      rules[entry.key] = ruleSet.addRule(constructId(entry.key), builder.toOptions(context));
    }

    const activation = this.#activate
      ? activateReceiptRuleSet(scope, `${id}Activation`, ruleSet)
      : undefined;

    return { ruleSet, rules, ...(activation && { activation }) };
  }
}

/**
 * Creates a fluent builder for an SES receipt rule set.
 */
export function createReceiptRuleSetBuilder(): IReceiptRuleSetBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ReceiptRuleSet has no Tags property
  return Builder<ReceiptRuleSetBuilderProps, ReceiptRuleSetBuilder>(ReceiptRuleSetBuilder);
}
