import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type Alias, type IKey, Key, KeySpec, type KeyProps } from "aws-cdk-lib/aws-kms";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { KeyAlarmConfig } from "./alarm-config.js";
import { createKeyAlarms } from "./key-alarms.js";
import { KEY_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the KMS key builder.
 *
 * Extends the CDK {@link KeyProps} with additional builder-specific options.
 */
export interface KeyBuilderProps extends KeyProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * The one AWS-recommended KMS alarm covers imported key material and is
   * opt-in — see {@link KeyAlarmConfig}. Set to `false` to disable the
   * recommended set entirely; custom alarms added via `addAlarm()` are still
   * created.
   *
   * No alarm actions are configured by default since notification methods are
   * user-specific. Access alarms from the build result or use an `afterBuild`
   * hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html
   */
  recommendedAlarms?: KeyAlarmConfig | false;
}

/**
 * The build output of an {@link IKeyBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface KeyBuilderResult {
  /** The KMS customer-managed key created by the builder. */
  key: Key;

  /**
   * The alias created for the key, or `undefined` when no `alias` was
   * configured. Surfaced so a consumer can reference the alias name — e.g.
   * to pass `alias/…` to an SDK client that resolves keys by alias.
   */
  alias?: Alias;

  /**
   * CloudWatch alarms created for the key, keyed by alarm name — both the
   * AWS-recommended alarms and any added via {@link IKeyBuilder.addAlarm}.
   * No alarm actions are configured.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an AWS KMS customer-managed
 * key (CMK).
 *
 * Each configuration property from the CDK {@link KeyProps} is exposed as an
 * overloaded method: call with a value to set it (returns the builder for
 * chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so a key can be an ordinary
 * component of a {@link compose | composed system} — placed by the stack
 * strategy, ordered by the dependency graph, and referenced by the resources
 * it encrypts via `ref()`. The key-consuming props across the library accept a
 * `Resolvable` — the package README tabulates them — so the edge is declared in
 * the dependency map rather than closed over from an imperative prologue.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kms.Key.html
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     tableKey: createKeyBuilder()
 *       .description("Encrypts the Orders table at rest.")
 *       .alias("orders/table"),
 *     table: createTableV2Builder()
 *       .partitionKey({ name: "orderId", type: AttributeType.STRING })
 *       .encryption(ref("tableKey", (r: KeyBuilderResult) =>
 *         TableEncryptionV2.customerManagedKey(r.key),
 *       )),
 *   },
 *   { tableKey: [], table: ["tableKey"] },
 * );
 * ```
 */
export type IKeyBuilder = ITaggedBuilder<KeyBuilderProps, KeyBuilder>;

class KeyBuilder implements Lifecycle<KeyBuilderResult> {
  props: Partial<KeyBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IKey>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<IKey>) => AlarmDefinitionBuilder<IKey>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IKey>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: KeyBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): KeyBuilderResult {
    const { recommendedAlarms: alarmConfig, alias, ...configured } = this.props;

    const key = new Key(scope, id, mergeKeyDefaults(configured));

    // Created here rather than passed through as `KeyProps.alias` so the Alias
    // construct is available for the result (build results must be complete).
    // `addAlias` is what the prop does internally, under the same construct id.
    const keyAlias = alias === undefined ? undefined : key.addAlias(alias);

    const alarms = createKeyAlarms(scope, id, key, alarmConfig, this.#customAlarms);

    return { key, alias: keyAlias, alarms };
  }
}

/**
 * Merges {@link KEY_DEFAULTS} under the user's props, then resolves the one
 * case where a default is mutually exclusive with a sibling the user set
 * (ADR-0009): AWS KMS only rotates symmetric encryption keys, so the
 * `enableKeyRotation` default yields to an asymmetric or HMAC `keySpec`.
 * Setting both explicitly is left for CDK to reject.
 */
function mergeKeyDefaults(props: Partial<KeyProps>): KeyProps {
  const merged = { ...KEY_DEFAULTS, ...props };

  const rotatable = props.keySpec === undefined || props.keySpec === KeySpec.SYMMETRIC_DEFAULT;
  if (!rotatable && props.enableKeyRotation === undefined) {
    delete merged.enableKeyRotation;
  }

  return merged;
}

/**
 * Creates a new {@link IKeyBuilder} for configuring an AWS KMS customer-managed
 * key.
 *
 * This is the entry point for defining a KMS key component. The returned
 * builder exposes every {@link KeyBuilderProps} property as a fluent
 * setter/getter and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS KMS key.
 *
 * @example
 * ```ts
 * const key = createKeyBuilder()
 *   .description("Encrypts the task publisher dead-letter bucket.")
 *   .alias("task-publisher/dlq");
 *
 * // Use standalone:
 * const result = key.build(stack, "DlqBucketKey");
 *
 * // Or compose into a system, wiring the key into the bucket it protects:
 * const system = compose(
 *   { key, bucket: createBucketBuilder().encryptionKey(ref("key").get("key")) },
 *   { key: [], bucket: ["key"] },
 * );
 * ```
 */
export function createKeyBuilder(): IKeyBuilder {
  return taggedBuilder<KeyBuilderProps, KeyBuilder>(KeyBuilder);
}
