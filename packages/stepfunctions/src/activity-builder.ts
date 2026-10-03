import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Activity, type ActivityProps } from "aws-cdk-lib/aws-stepfunctions";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { ActivityAlarmConfig } from "./activity-alarm-config.js";
import { ACTIVITY_ALARMS } from "./activity-alarms.js";
import { createSpecAlarms } from "./alarm-specs.js";

/**
 * Configuration properties for the Step Functions activity builder: the CDK
 * {@link ActivityProps}, with `encryptionConfiguration` widened to
 * {@link Resolvable} so its key can come from a composed sibling (ADR-0018).
 */
export interface ActivityBuilderProps extends Omit<ActivityProps, "encryptionConfiguration"> {
  /**
   * Server-side encryption of the activity's task inputs. Step Functions uses
   * an AWS-owned key by default; pass a `CustomerManagedEncryptionConfiguration`
   * to use your own. Changing it replaces the activity.
   *
   * @see https://docs.aws.amazon.com/step-functions/latest/dg/encryption-at-rest.html
   */
  encryptionConfiguration?: Resolvable<NonNullable<ActivityProps["encryptionConfiguration"]>>;

  /** The recommended CloudWatch alarms — see {@link ActivityAlarmConfig}; `false` disables them. */
  recommendedAlarms?: ActivityAlarmConfig | false;
}

/** The build output of a {@link IActivityBuilder}. */
export interface ActivityBuilderResult {
  /** The Step Functions activity construct created by the builder. */
  activity: Activity;

  /**
   * CloudWatch alarms created for the activity, keyed by alarm name — the
   * recommended alarms and any added via {@link IActivityBuilder.addAlarm}.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for a Step Functions activity: a task a state machine hands
 * to workers that poll for it.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html
 */
export type IActivityBuilder = ITaggedBuilder<ActivityBuilderProps, ActivityBuilder>;

class ActivityBuilder implements Lifecycle<ActivityBuilderResult> {
  props: Partial<ActivityBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<Activity>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<Activity>) => AlarmDefinitionBuilder<Activity>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<Activity>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ActivityBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): ActivityBuilderResult {
    const { encryptionConfiguration, recommendedAlarms, ...activityProps } = this.props;

    const activity = new Activity(scope, id, {
      ...activityProps,
      ...(encryptionConfiguration !== undefined
        ? { encryptionConfiguration: resolve(encryptionConfiguration, context) }
        : {}),
    });

    const alarms = createSpecAlarms(
      scope,
      id,
      activity,
      ACTIVITY_ALARMS,
      recommendedAlarms,
      this.#customAlarms,
    );

    return { activity, alarms };
  }
}

/**
 * Creates a new {@link IActivityBuilder} for a Step Functions activity.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     review: createActivityBuilder(),
 *     worker: createFunctionBuilder()./* ... *\/.grant(
 *       activityGrants.worker(ref<ActivityBuilderResult>("review").get("activity")),
 *     ),
 *   },
 *   { review: [], worker: ["review"] },
 * );
 * ```
 */
export function createActivityBuilder(): IActivityBuilder {
  return taggedBuilder<ActivityBuilderProps, ActivityBuilder>(ActivityBuilder);
}
