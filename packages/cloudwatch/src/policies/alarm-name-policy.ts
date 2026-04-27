import { Aspects, Stack } from "aws-cdk-lib";
import { CfnAlarm, CfnCompositeAlarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IConstruct } from "constructs";
import { type AlarmName, alarmName as brandAlarmName } from "../alarm-name.js";
import { type AlarmMatchContext, type AlarmRuleScope, ruleMatches } from "./policy-matcher.js";

/** Context passed to {@link AlarmNameRule.transform}. */
export interface AlarmNameTransformContext extends AlarmMatchContext {
  /**
   * The alarm name as it stands at the moment this rule's transform runs:
   * the original alarm name plus any prefix/suffix decorations contributed
   * by `defaults` and earlier matched rules.
   */
  readonly currentName: string;
}

/**
 * A rule for {@link alarmNamePolicy}. A rule matches when **any** supplied
 * matcher matches.
 *
 * - `prefix` / `suffix` decorate the current name.
 * - `transform` produces a new name from scratch and wins over `prefix`/`suffix`
 *   when both are set on the same rule.
 * - Multiple matched rules layer in declaration order.
 */
export interface AlarmNameRule extends AlarmRuleScope {
  /** Prepended to the current name with the configured separator. */
  prefix?: string;
  /** Appended to the current name with the configured separator. */
  suffix?: string;
  /** Full transform — wins over `prefix`/`suffix` on the same rule. */
  transform?: (ctx: AlarmNameTransformContext) => AlarmName;
  /** When `true`, this rule's `prefix`/`suffix` replace `defaults` rather than layering on top. */
  replaceDefaults?: boolean;
}

/** Configuration for {@link alarmNamePolicy}. */
export interface AlarmNamePolicyConfig {
  /** Decorations applied to every alarm unless a matching rule sets `replaceDefaults: true`. */
  defaults?: Pick<AlarmNameRule, "prefix" | "suffix">;
  /** Ordered list of rules. All matching rules contribute. */
  rules?: AlarmNameRule[];
  /**
   * Separator between prefix / current-name / suffix segments.
   * @default "-"
   */
  separator?: string;
}

function decorate(
  current: string,
  prefix: string | undefined,
  suffix: string | undefined,
  sep: string,
): string {
  const parts: string[] = [];
  if (prefix !== undefined && prefix.length > 0) parts.push(prefix);
  parts.push(current);
  if (suffix !== undefined && suffix.length > 0) parts.push(suffix);
  return parts.join(sep);
}

function resolveAlarmName(cfn: CfnAlarm | CfnCompositeAlarm): string | undefined {
  const value = cfn.alarmName;
  if (value === undefined) return undefined;
  const resolved: unknown = Stack.of(cfn).resolve(value);
  return typeof resolved === "string" ? resolved : undefined;
}

/**
 * Decorates CloudWatch alarm names across an entire scope.
 *
 * Installs a CDK
 * {@link https://docs.aws.amazon.com/cdk/v2/guide/aspects.html | Aspect}
 * that fires during the synth prepare phase. For every `AWS::CloudWatch::Alarm`
 * (and `AWS::CloudWatch::CompositeAlarm`) found beneath `scope`:
 *
 * 1. The alarm's existing name is read (set by the library default or the
 *    consumer's per-alarm override).
 * 2. `defaults.prefix` / `defaults.suffix` decorate it, unless a matched
 *    rule sets `replaceDefaults: true`.
 * 3. Each matching rule contributes in declaration order — `transform`
 *    replaces the current name; otherwise `prefix`/`suffix` decorate.
 * 4. The final value is validated via {@link alarmName} and written back to
 *    `cfn.alarmName`.
 *
 * Use cases: stage prefixing (`prod-…`), severity tagging (`…-critical`),
 * team scoping. Composes with per-alarm `alarmName` overrides — those run
 * first, the policy decorates the result.
 *
 * @example
 * ```ts
 * alarmNamePolicy(app, {
 *   defaults: { prefix: "prod" },
 *   rules: [
 *     { match: /Errors$/, suffix: "critical" },
 *     { match: "throttles", suffix: "warning" },
 *   ],
 * });
 * ```
 */
export function alarmNamePolicy(scope: IConstruct, config: AlarmNamePolicyConfig): void {
  const { defaults, rules = [], separator = "-" } = config;
  const processed = new WeakSet<CfnAlarm | CfnCompositeAlarm>();

  Aspects.of(scope).add({
    visit(node: IConstruct): void {
      const isAlarm = CfnAlarm.isCfnAlarm(node);
      const isComposite = CfnCompositeAlarm.isCfnCompositeAlarm(node);
      if (!isAlarm && !isComposite) return;
      const cfn = node;
      if (processed.has(cfn)) return;

      const original = resolveAlarmName(cfn);
      if (original === undefined) return;

      const parent = cfn.node.scope;
      const ctx: AlarmMatchContext = {
        alarm: undefined,
        cfn,
        id: parent?.node.id ?? cfn.node.id,
        path: parent?.node.path ?? cfn.node.path,
        isComposite,
      };

      const matched = rules.filter((r) => ruleMatches(r, ctx));
      const replaceDefaults = matched.some((r) => r.replaceDefaults === true);

      let current = original;

      if (defaults !== undefined && !replaceDefaults) {
        current = decorate(current, defaults.prefix, defaults.suffix, separator);
      }

      for (const rule of matched) {
        if (rule.transform !== undefined) {
          current = rule.transform({ ...ctx, currentName: current });
          continue;
        }
        current = decorate(current, rule.prefix, rule.suffix, separator);
      }

      if (current === original) return;

      const validated: AlarmName = brandAlarmName(current);
      cfn.alarmName = validated;
      processed.add(cfn);
    },
  });
}
