import {
  ConfigurationSet,
  type ConfigurationSetEventDestination,
  type ConfigurationSetProps,
  type EmailSendingEvent,
  type EventDestination,
} from "aws-cdk-lib/aws-ses";
import { type IConstruct } from "constructs";
import {
  Builder,
  COPY_STATE,
  constructId,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { CONFIGURATION_SET_DEFAULTS } from "./configuration-set-defaults.js";

/**
 * Configuration for the SES configuration-set builder. Every
 * {@link ConfigurationSetProps} field passes through unchanged; event
 * destinations are owned by {@link IConfigurationSetBuilder.addEventDestination}.
 */
export type ConfigurationSetBuilderProps = ConfigurationSetProps;

/** Options for a single configuration-set event destination. */
export interface EventDestinationOptions {
  /**
   * Where to publish the events — an SNS topic, EventBridge bus, or CloudWatch
   * dimensions. Use the {@link snsDestination} / {@link eventBusDestination} /
   * {@link cloudWatchDestination} helpers, which accept `Resolvable`s so a
   * destination can `ref()` a sibling component.
   */
  readonly destination: Resolvable<EventDestination>;
  /**
   * The send events to publish. Defaults to SES's behaviour of publishing all
   * event types when omitted.
   */
  readonly events?: EmailSendingEvent[];
  /**
   * Whether SES publishes events to this destination.
   * @default true
   */
  readonly enabled?: boolean;
}

/** The build output of an {@link IConfigurationSetBuilder}. */
export interface ConfigurationSetBuilderResult {
  /** The SES configuration set construct. */
  configurationSet: ConfigurationSet;
  /**
   * Event destinations added via
   * {@link IConfigurationSetBuilder.addEventDestination}, keyed by the name
   * supplied to that call. Always present — `{}` when none were added.
   */
  eventDestinations: Record<string, ConfigurationSetEventDestination>;
}

/**
 * A fluent builder for an SES configuration set — the unit that tracks and
 * controls a stream of outbound mail (TLS enforcement, reputation metrics,
 * suppression, and event routing). TLS is required and reputation metrics are on
 * by default; both are individually overridable.
 *
 * @example
 * ```ts
 * const { configurationSet } = createConfigurationSetBuilder()
 *   .addEventDestination("feedback", {
 *     destination: snsDestination(ref<TopicBuilderResult>("events").get("topic")),
 *     events: [EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT],
 *   })
 *   .build(stack, "MailConfig");
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ConfigurationSet has no Tags property
export type IConfigurationSetBuilder = IBuilder<
  ConfigurationSetBuilderProps,
  ConfigurationSetBuilder
>;

interface EventDestinationEntry {
  key: string;
  options: EventDestinationOptions;
}

class ConfigurationSetBuilder implements Lifecycle<ConfigurationSetBuilderResult> {
  props: Partial<ConfigurationSetBuilderProps> = {};
  readonly #eventDestinations: EventDestinationEntry[] = [];

  /**
   * Register an event destination for this configuration set. Accepts a
   * {@link snsDestination} / {@link eventBusDestination} / {@link cloudWatchDestination}
   * helper (each `Resolvable`, so it can `ref()` a sibling topic or bus) and the
   * {@link EmailSendingEvent}s to publish. Routing bounce/complaint events is how
   * a sender drives suppression — AWS requires you to track them.
   */
  addEventDestination(key: string, options: EventDestinationOptions): this {
    if (this.#eventDestinations.some((e) => e.key === key)) {
      throw new Error(
        `ConfigurationSetBuilder.addEventDestination: duplicate key "${key}". ` +
          `Each event destination must use a unique key.`,
      );
    }
    this.#eventDestinations.push({ key, options });
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: ConfigurationSetBuilder): void {
    target.#eventDestinations.push(...this.#eventDestinations);
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): ConfigurationSetBuilderResult {
    const mergedProps = { ...CONFIGURATION_SET_DEFAULTS, ...this.props };
    const configurationSet = new ConfigurationSet(scope, id, mergedProps);

    const eventDestinations: Record<string, ConfigurationSetEventDestination> = {};
    for (const entry of this.#eventDestinations) {
      const { destination, events, enabled } = entry.options;
      eventDestinations[entry.key] = configurationSet.addEventDestination(constructId(entry.key), {
        destination: resolve(destination, context),
        ...(events !== undefined && { events }),
        ...(enabled !== undefined && { enabled }),
      });
    }

    return { configurationSet, eventDestinations };
  }
}

/**
 * Creates a fluent builder for an SES configuration set.
 */
export function createConfigurationSetBuilder(): IConfigurationSetBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::ConfigurationSet has no Tags property
  return Builder<ConfigurationSetBuilderProps, ConfigurationSetBuilder>(ConfigurationSetBuilder);
}
