import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { ReputationAlarmConfig } from "./reputation-alarm-config.js";
import { createReputationAlarms } from "./reputation-alarms.js";

/**
 * Configuration for the account-level SES reputation alarm builder.
 */
export interface ReputationAlarmBuilderProps {
  /**
   * Configuration for the AWS-recommended reputation alarms.
   *
   * By default the builder creates both recommended alarms (bounce rate and
   * complaint rate) with AWS-recommended thresholds. Individual alarms can be
   * customized or disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification methods are
   * user-specific. Access alarms from the build result or use an `afterBuild`
   * hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html
   */
  recommendedAlarms?: ReputationAlarmConfig | false;
}

/** The build output of an {@link IReputationAlarmBuilder}. */
export interface ReputationAlarmBuilderResult {
  /**
   * The reputation alarms created, keyed by alarm name (`bounceRate`,
   * `complaintRate`, plus any custom alarm keys). Always present — `{}` when
   * alarms were disabled.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for the account-level SES reputation alarms — the sending
 * safety net. `Reputation.BounceRate` and `Reputation.ComplaintRate` are
 * account/Region-scoped metrics, so this builder creates alarms in whatever
 * scope it is built into, independent of any configuration set or identity, and
 * only **once per account/Region** is needed.
 *
 * @example
 * ```ts
 * const { alarms } = createReputationAlarmBuilder().build(stack, "SesReputation");
 * ```
 */
export type IReputationAlarmBuilder = ITaggedBuilder<
  ReputationAlarmBuilderProps,
  ReputationAlarmBuilder
>;

class ReputationAlarmBuilder implements Lifecycle<ReputationAlarmBuilderResult> {
  props: Partial<ReputationAlarmBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<void>[] = [];

  /**
   * Add a custom alarm alongside the recommended ones. The metric factory
   * receives no target (SES reputation metrics are account-level), so build the
   * metric directly — e.g. a `Reject`-count or `RenderingFailure` alarm.
   */
  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<void>) => AlarmDefinitionBuilder<void>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<void>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ReputationAlarmBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): ReputationAlarmBuilderResult {
    const alarms = createReputationAlarms(
      scope,
      id,
      this.props.recommendedAlarms,
      this.#customAlarms,
    );
    return { alarms };
  }
}

/**
 * Creates a fluent builder for the account-level SES reputation alarms.
 */
export function createReputationAlarmBuilder(): IReputationAlarmBuilder {
  return taggedBuilder<ReputationAlarmBuilderProps, ReputationAlarmBuilder>(ReputationAlarmBuilder);
}
