import { type IEventBus, type IRuleTarget, Rule, type RuleProps } from "aws-cdk-lib/aws-events";
import { type IConstruct } from "constructs";
import {
  Builder,
  COPY_STATE,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { RULE_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the EventBridge rule builder.
 *
 * Extends the CDK {@link RuleProps} but accepts a {@link Resolvable} for
 * `eventBus` so the rule can be wired to a sibling component (or a custom
 * event bus built elsewhere) via {@link ref} inside a {@link compose}d
 * system. `targets` is excluded — use {@link IRuleBuilder.addTarget} so each
 * target can carry its own `Resolvable` and be exposed in the build result.
 */
export interface RuleBuilderProps extends Omit<RuleProps, "targets" | "eventBus"> {
  /**
   * The event bus the rule listens on. Accepts a concrete {@link IEventBus} or
   * a {@link Ref} to another component's output. When omitted, the rule
   * attaches to the account default bus, matching CDK's `RuleProps.eventBus`
   * default.
   */
  eventBus?: Resolvable<IEventBus>;
}

/**
 * The build output of an {@link IRuleBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface RuleBuilderResult {
  /** The EventBridge rule construct created by the builder. */
  rule: Rule;

  /**
   * Resolved {@link IRuleTarget}s registered via
   * {@link IRuleBuilder.addTarget}, keyed by the key passed to that call.
   *
   * Always present — `{}` when no targets were added.
   */
  targets: Record<string, IRuleTarget>;
}

/**
 * A fluent builder for configuring and creating an AWS EventBridge rule.
 *
 * Each configuration property from the CDK {@link RuleProps} is exposed as
 * an overloaded method: call with a value to set it (returns the builder for
 * chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates an
 * EventBridge rule with the configured properties and returns a
 * {@link RuleBuilderResult}.
 *
 * Targets are registered via {@link addTarget} and accept a
 * {@link Resolvable}, so cross-component wiring (a sibling Lambda, queue,
 * topic, …) flows through the same {@link Ref} machinery as everything else.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.Rule.html
 *
 * @example
 * ```ts
 * import { Schedule } from "aws-cdk-lib/aws-events";
 * import { Duration } from "aws-cdk-lib";
 *
 * const rule = createRuleBuilder()
 *   .schedule(Schedule.rate(Duration.minutes(15)))
 *   .description("Idle stopper")
 *   .addTarget("stopper", lambdaTarget(idleStopperFn));
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::Events::Rule has no Tags property
export type IRuleBuilder = IBuilder<RuleBuilderProps, RuleBuilder>;

interface TargetEntry {
  key: string;
  target: Resolvable<IRuleTarget>;
}

class RuleBuilder implements Lifecycle<RuleBuilderResult> {
  props: Partial<RuleBuilderProps> = {};
  readonly #targets: TargetEntry[] = [];

  /**
   * Register a target to be attached to the rule at build time.
   *
   * Accepts any concrete {@link IRuleTarget} (the lightweight helpers in
   * `./targets/` produce these) or a {@link Resolvable} so targets that wire
   * cross-component references can be declared at configuration time. The
   * resolved target is exposed on {@link RuleBuilderResult.targets} under
   * `key`.
   */
  addTarget(key: string, target: Resolvable<IRuleTarget>): this {
    if (this.#targets.some((t) => t.key === key)) {
      throw new Error(
        `RuleBuilder.addTarget: duplicate key "${key}". Each target must use a unique key.`,
      );
    }
    this.#targets.push({ key, target });
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): RuleBuilderResult {
    const ctx = context ?? {};
    const { eventBus, ...rest } = this.props;

    if (rest.schedule === undefined && rest.eventPattern === undefined) {
      throw new Error(
        `RuleBuilder "${id}": at least one of .schedule(...) or .eventPattern(...) must be set. ` +
          "An EventBridge rule with neither is inert and never matches.",
      );
    }

    const mergedProps: RuleProps = {
      ...RULE_DEFAULTS,
      ...rest,
      ...(eventBus !== undefined && { eventBus: resolve(eventBus, ctx) }),
    };

    const rule = new Rule(scope, id, mergedProps);

    const targets: Record<string, IRuleTarget> = {};
    for (const entry of this.#targets) {
      const resolved = resolve(entry.target, ctx);
      rule.addTarget(resolved);
      targets[entry.key] = resolved;
    }

    return { rule, targets };
  }

  /** Deep-clones the target accumulator so `.copy()` produces an independent builder. */
  [COPY_STATE](next: RuleBuilder): void {
    next.#targets.push(...this.#targets);
  }
}

/**
 * Creates a new {@link IRuleBuilder} for configuring an AWS EventBridge rule.
 *
 * This is the entry point for defining an EventBridge rule component. The
 * returned builder exposes every {@link RuleBuilderProps} property as a
 * fluent setter/getter and implements {@link Lifecycle} for use with
 * {@link compose}.
 *
 * @example
 * ```ts
 * import { compose, ref } from "@composurecdk/core";
 * import { createRuleBuilder, lambdaTarget } from "@composurecdk/events";
 * import { Schedule } from "aws-cdk-lib/aws-events";
 * import { Duration } from "aws-cdk-lib";
 *
 * const system = compose(
 *   {
 *     stopper: createFunctionBuilder()...,
 *     idleStopperSchedule: createRuleBuilder()
 *       .schedule(Schedule.rate(Duration.minutes(15)))
 *       .addTarget("stopper", lambdaTarget(ref("stopper", (r) => r.function))),
 *   },
 *   { stopper: [], idleStopperSchedule: ["stopper"] },
 * );
 * ```
 */
export function createRuleBuilder(): IRuleBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::Events::Rule has no Tags property
  return Builder<RuleBuilderProps, RuleBuilder>(RuleBuilder);
}
