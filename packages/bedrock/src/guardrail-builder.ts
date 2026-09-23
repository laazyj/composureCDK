import { Stack } from "aws-cdk-lib";
import { CfnGuardrail, type CfnGuardrailProps, CfnGuardrailVersion } from "aws-cdk-lib/aws-bedrock";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder, createAlarms } from "@composurecdk/cloudwatch";
import {
  type GuardrailAlarmConfig,
  type GuardrailMetrics,
  guardrailMetrics,
  resolveGuardrailAlarmDefinitions,
} from "./guardrail-alarms.js";
import { GUARDRAIL_DEFAULTS } from "./guardrail-defaults.js";

/** A guardrail's ARN and published version. */
export interface GuardrailReference {
  /** The guardrail's ARN, without a version. */
  readonly guardrailArn: string;
  /** The published version, e.g. `"1"`. */
  readonly version: string;
}

/** Configuration properties for {@link createGuardrailBuilder}. */
export interface GuardrailBuilderProps extends Omit<CfnGuardrailProps, "tags" | "kmsKeyArn"> {
  /** A customer managed key to encrypt the guardrail with. */
  kmsKeyArn?: Resolvable<NonNullable<CfnGuardrailProps["kmsKeyArn"]>>;

  /**
   * Configuration for the recommended alarms, which are all opt-in. Set to
   * `false` to disable them; alarms added with `addAlarm()` are unaffected.
   */
  recommendedAlarms?: GuardrailAlarmConfig | false;
}

/** The build output of an {@link IGuardrailBuilder}. */
export interface GuardrailBuilderResult {
  guardrail: CfnGuardrail;
  /** The published version callers should use, rather than the working draft. */
  version: CfnGuardrailVersion;
  /** The guardrail's ARN and published version, for grants and invocations. */
  reference: GuardrailReference;
  /** The CloudWatch alarms created, keyed by alarm key. */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for an Amazon Bedrock guardrail.
 *
 * @see {@link createGuardrailBuilder}
 */
export type IGuardrailBuilder = ITaggedBuilder<GuardrailBuilderProps, GuardrailBuilder>;

/** 32-bit FNV-1a, as 8 hex digits. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

class GuardrailBuilder implements Lifecycle<GuardrailBuilderResult> {
  props: Partial<GuardrailBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<GuardrailMetrics>[] = [];

  /**
   * Adds a custom alarm. The metric factory receives the guardrail version's
   * {@link GuardrailMetrics}.
   */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<GuardrailMetrics>,
    ) => AlarmDefinitionBuilder<GuardrailMetrics>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<GuardrailMetrics>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: GuardrailBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): GuardrailBuilderResult {
    const { kmsKeyArn, recommendedAlarms, ...rest } = this.props;
    if (!rest.name) {
      throw new Error(`GuardrailBuilder "${id}" requires a name. Call .name().`);
    }
    const props: CfnGuardrailProps = {
      ...GUARDRAIL_DEFAULTS,
      ...rest,
      name: rest.name,
      ...(kmsKeyArn !== undefined && { kmsKeyArn: resolve(kmsKeyArn, context) }),
    };
    const guardrail = new CfnGuardrail(scope, id, props);

    // A version is a snapshot, so a configuration change publishes a new one.
    const fingerprint = fnv1a(JSON.stringify(Stack.of(scope).resolve(props)));
    const version = new CfnGuardrailVersion(scope, `${id}Version${fingerprint}`, {
      guardrailIdentifier: guardrail.attrGuardrailId,
    });

    const reference = { guardrailArn: guardrail.attrGuardrailArn, version: version.attrVersion };
    const metrics = guardrailMetrics(reference);
    const alarms = createAlarms(scope, id, [
      ...resolveGuardrailAlarmDefinitions(metrics, recommendedAlarms),
      ...this.#customAlarms.map((b) => b.resolve(metrics)),
    ]);

    return { guardrail, version, reference, alarms };
  }
}

/**
 * Creates a builder for an Amazon Bedrock guardrail and a published version
 * of it ([GENSEC02-BP01](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec02-bp01.html)).
 *
 * By default it filters every harmful-content category and prompt attacks at
 * `HIGH` ({@link GUARDRAIL_DEFAULTS}). Pass its `reference` to
 * `modelGrants.invoke(target, { requireGuardrail })` to make callers use it.
 *
 * @example
 * ```ts
 * createGuardrailBuilder()
 *   .name("support-assistant")
 *   .topicPolicyConfig({ topicsConfig: [{ name: "Legal", definition: "Legal advice.", type: "DENY" }] });
 * ```
 */
export function createGuardrailBuilder(): IGuardrailBuilder {
  return taggedBuilder<GuardrailBuilderProps, GuardrailBuilder>(GuardrailBuilder);
}
