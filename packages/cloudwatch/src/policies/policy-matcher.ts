import { CfnResource } from "aws-cdk-lib";
import { CfnAlarm, CfnCompositeAlarm, type IAlarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";

/**
 * Version-portable replacement for `CfnAlarm.isCfnAlarm`, which only exists in
 * aws-cdk-lib >= ~2.250 and throws `TypeError` on older versions inside our
 * declared `^2.0.0` peer range (issue #146). Checks the foundational
 * `CfnResource.isCfnResource` guard plus a `cfnResourceType` compare — exactly
 * what the modern static does internally — so it works across the full range.
 */
export function isCfnAlarm(x: IConstruct): x is CfnAlarm {
  return CfnResource.isCfnResource(x) && x.cfnResourceType === CfnAlarm.CFN_RESOURCE_TYPE_NAME;
}

/**
 * Version-portable replacement for `CfnCompositeAlarm.isCfnCompositeAlarm`.
 * See {@link isCfnAlarm} for why this exists.
 */
export function isCfnCompositeAlarm(x: IConstruct): x is CfnCompositeAlarm {
  return (
    CfnResource.isCfnResource(x) && x.cfnResourceType === CfnCompositeAlarm.CFN_RESOURCE_TYPE_NAME
  );
}

/**
 * Selects which alarms a rule applies to.
 *
 * - `string` — substring match against the alarm's `id` OR `path`.
 * - `RegExp` — tested against `path`.
 * - predicate — receives the full {@link AlarmMatchContext}.
 */
export type AlarmMatcher = string | RegExp | ((ctx: AlarmMatchContext) => boolean);

/**
 * Context passed to matcher predicates and derived for every visited alarm.
 *
 * `id` and `path` come from the L2 alarm when one is present, otherwise from
 * the L1 `CfnAlarm` / `CfnCompositeAlarm`.
 */
export interface AlarmMatchContext {
  readonly alarm: IAlarm | undefined;
  readonly cfn: CfnAlarm | CfnCompositeAlarm;
  readonly id: string;
  readonly path: string;
  readonly isComposite: boolean;
}

/** Common scoping flags shared by every alarm-policy rule shape. */
export interface AlarmRuleScope {
  match: AlarmMatcher | AlarmMatcher[];
  singleOnly?: boolean;
  compositeOnly?: boolean;
}

export function matchesOne(matcher: AlarmMatcher, ctx: AlarmMatchContext): boolean {
  if (typeof matcher === "function") return matcher(ctx);
  if (matcher instanceof RegExp) return matcher.test(ctx.path);
  return ctx.id.includes(matcher) || ctx.path.includes(matcher);
}

export function ruleMatches(rule: AlarmRuleScope, ctx: AlarmMatchContext): boolean {
  if (rule.singleOnly === true && ctx.isComposite) return false;
  if (rule.compositeOnly === true && !ctx.isComposite) return false;
  const matchers = Array.isArray(rule.match) ? rule.match : [rule.match];
  return matchers.some((m) => matchesOne(m, ctx));
}
