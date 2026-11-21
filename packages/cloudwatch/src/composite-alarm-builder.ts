import { CompositeAlarm, type CompositeAlarmProps } from "aws-cdk-lib/aws-cloudwatch";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import type { AlarmName } from "./alarm-name.js";
import { defaultAlarmName } from "./default-alarm-name.js";

/**
 * Configuration properties for the composite alarm builder.
 *
 * CDK's {@link CompositeAlarmProps}, with the rule and the actions suppressor
 * widened to {@link Resolvable} so they can come from other components, and
 * the name branded as an {@link AlarmName}.
 */
export interface CompositeAlarmBuilderProps extends Omit<
  CompositeAlarmProps,
  "alarmRule" | "actionsSuppressor" | "compositeAlarmName"
> {
  /**
   * The rule that decides the composite's state. Required. Accepts a
   * {@link Ref}; combine members from several components with `combine`.
   */
  alarmRule: Resolvable<CompositeAlarmProps["alarmRule"]>;

  /**
   * An alarm whose ALARM state suppresses this composite's actions. Accepts a
   * {@link Ref} so the suppressor can come from another component.
   */
  actionsSuppressor?: Resolvable<NonNullable<CompositeAlarmProps["actionsSuppressor"]>>;

  /**
   * The composite's name. Build one with {@link alarmName}.
   *
   * @default `${stack}/${path}/${kebab(id)}`, from {@link defaultAlarmName}.
   */
  compositeAlarmName?: AlarmName;
}

/** The build output of an {@link ICompositeAlarmBuilder}. */
export interface CompositeAlarmBuilderResult {
  /** The composite alarm construct created by the builder. */
  alarm: CompositeAlarm;
}

/**
 * A fluent builder for a CloudWatch composite alarm whose rule combines alarms
 * from other components.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html
 */
export type ICompositeAlarmBuilder = ITaggedBuilder<
  CompositeAlarmBuilderProps,
  CompositeAlarmBuilder
>;

class CompositeAlarmBuilder implements Lifecycle<CompositeAlarmBuilderResult> {
  props: Partial<CompositeAlarmBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): CompositeAlarmBuilderResult {
    const { alarmRule, actionsSuppressor, compositeAlarmName, ...rest } = this.props;
    if (alarmRule === undefined) {
      throw new Error(
        `CompositeAlarmBuilder "${id}": alarmRule is required. Call .alarmRule(...) with an IAlarmRule or a Ref before building.`,
      );
    }

    return {
      alarm: new CompositeAlarm(scope, id, {
        ...rest,
        compositeAlarmName: compositeAlarmName ?? defaultAlarmName(scope, id),
        alarmRule: resolve(alarmRule, context),
        actionsSuppressor:
          actionsSuppressor === undefined ? undefined : resolve(actionsSuppressor, context),
      }),
    };
  }
}

/**
 * Creates a builder for a CloudWatch composite alarm. See the package README
 * for an example that combines alarms from several components.
 */
export function createCompositeAlarmBuilder(): ICompositeAlarmBuilder {
  return taggedBuilder<CompositeAlarmBuilderProps, CompositeAlarmBuilder>(CompositeAlarmBuilder);
}
