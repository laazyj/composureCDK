import { Aspects, Stack } from "aws-cdk-lib";
import {
  CfnAlarm,
  CfnCompositeAlarm,
  type IAlarm,
  type IAlarmAction,
} from "aws-cdk-lib/aws-cloudwatch";
import { type IConstruct } from "constructs";

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

/** A set of actions, one array per alarm state. All arrays are optional. */
export interface AlarmActionSet {
  alarmActions?: IAlarmAction[];
  okActions?: IAlarmAction[];
  insufficientDataActions?: IAlarmAction[];
}

/** A rule: a matcher (or matchers) plus an action set, with optional scoping flags. */
export interface AlarmActionRule extends AlarmActionSet {
  /** Matcher(s). A rule matches when **any** supplied matcher matches. */
  match: AlarmMatcher | AlarmMatcher[];
  /** When this rule matches, suppress `defaults` for the alarm. */
  replaceDefaults?: boolean;
  /** Apply only to single (non-composite) alarms. */
  singleOnly?: boolean;
  /** Apply only to composite alarms. */
  compositeOnly?: boolean;
}

/** Configuration for {@link alarmActionsPolicy}. */
export interface AlarmActionsPolicyConfig {
  /** Actions applied to every matched alarm unless a matching rule sets `replaceDefaults: true`. */
  defaults?: AlarmActionSet;
  /** Ordered list of overrides. All matching rules contribute (append semantics). */
  rules?: AlarmActionRule[];
  /** Skip alarms that already have non-empty `alarmActions`. */
  skipIfAlreadyConfigured?: boolean;
}

interface L2AlarmLike {
  addAlarmAction(...actions: IAlarmAction[]): void;
  addOkAction(...actions: IAlarmAction[]): void;
  addInsufficientDataAction(...actions: IAlarmAction[]): void;
}

function isL2AlarmLike(node: IConstruct | undefined): node is IConstruct & L2AlarmLike {
  if (node === undefined) return false;
  const candidate = node as unknown as Record<string, unknown>;
  return (
    typeof candidate.addAlarmAction === "function" &&
    typeof candidate.addOkAction === "function" &&
    typeof candidate.addInsufficientDataAction === "function"
  );
}

function isAlreadyConfigured(cfn: CfnAlarm | CfnCompositeAlarm): boolean {
  // `cfn.alarmActions` is always a Lazy-wrapped array at aspect-visit time,
  // even when empty. Resolve it against the owning Stack to inspect real contents.
  const actions = cfn.alarmActions;
  if (actions === undefined) return false;
  const resolved: unknown = Stack.of(cfn).resolve(actions);
  if (resolved === undefined || resolved === null) return false;
  if (Array.isArray(resolved)) return resolved.length > 0;
  return true;
}

function matchesOne(matcher: AlarmMatcher, ctx: AlarmMatchContext): boolean {
  if (typeof matcher === "function") return matcher(ctx);
  if (matcher instanceof RegExp) return matcher.test(ctx.path);
  return ctx.id.includes(matcher) || ctx.path.includes(matcher);
}

function ruleMatches(rule: AlarmActionRule, ctx: AlarmMatchContext): boolean {
  if (rule.singleOnly === true && ctx.isComposite) return false;
  if (rule.compositeOnly === true && !ctx.isComposite) return false;
  const matchers = Array.isArray(rule.match) ? rule.match : [rule.match];
  return matchers.some((m) => matchesOne(m, ctx));
}

function dedupe<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

type AlarmVisitor = (
  cfn: CfnAlarm | CfnCompositeAlarm,
  alarm: (IConstruct & L2AlarmLike) | undefined,
  isComposite: boolean,
) => void;

function visitAlarms(scope: IConstruct, visit: AlarmVisitor): void {
  Aspects.of(scope).add({
    visit(node: IConstruct): void {
      const isAlarm = CfnAlarm.isCfnAlarm(node);
      const isComposite = CfnCompositeAlarm.isCfnCompositeAlarm(node);
      if (!isAlarm && !isComposite) return;
      const parent = node.node.scope;
      const l2 = isL2AlarmLike(parent) ? parent : undefined;
      visit(node, l2, isComposite);
    },
  });
}

/**
 * Attaches CloudWatch alarm actions to every `Alarm` and `CompositeAlarm`
 * (L2) construct in the subtree under `scope`.
 *
 * The policy installs a CDK {@link https://docs.aws.amazon.com/cdk/v2/guide/aspects.html | Aspect}
 * that fires during the synth prepare phase, so late-added alarms are also
 * covered. Detection uses the jsii type guards
 * `CfnAlarm.isCfnAlarm` / `CfnCompositeAlarm.isCfnCompositeAlarm` on the L1
 * resource; the L2 parent is found via duck-typing on `addAlarmAction`.
 * Actions are attached through the L2 so that `IAlarmAction.bind()` runs and
 * permissions are wired correctly. Bare `CfnAlarm` nodes (created without an
 * L2 wrapper) are detected but silently skipped.
 *
 * `defaults` apply to every matched alarm; `rules` append additional actions.
 * A rule matches if any of its `match` entries matches. Set
 * `replaceDefaults: true` on a rule to suppress defaults for its matched
 * alarms.
 *
 * @example
 * ```ts
 * alarmActionsPolicy(app, {
 *   defaults: { alarmActions: [new SnsAction(standardTopic)] },
 *   rules: [
 *     { match: "HighSev", alarmActions: [new SnsAction(pagerTopic)] },
 *   ],
 * });
 * ```
 */
export function alarmActionsPolicy(scope: IConstruct, config: AlarmActionsPolicyConfig): void {
  const { defaults, rules = [], skipIfAlreadyConfigured = false } = config;
  const processed = new WeakSet<IConstruct>();

  visitAlarms(scope, (cfn, alarm, isComposite) => {
    if (alarm === undefined) return;
    if (processed.has(alarm)) return;
    if (skipIfAlreadyConfigured && isAlreadyConfigured(cfn)) return;

    const ctx: AlarmMatchContext = {
      alarm: alarm as unknown as IAlarm,
      cfn,
      id: alarm.node.id,
      path: alarm.node.path,
      isComposite,
    };

    const matched = rules.filter((r) => ruleMatches(r, ctx));
    const replaceDefaults = matched.some((r) => r.replaceDefaults === true);

    const alarmActions: IAlarmAction[] = [];
    const okActions: IAlarmAction[] = [];
    const insufficientDataActions: IAlarmAction[] = [];

    if (defaults !== undefined && !replaceDefaults) {
      if (defaults.alarmActions !== undefined) alarmActions.push(...defaults.alarmActions);
      if (defaults.okActions !== undefined) okActions.push(...defaults.okActions);
      if (defaults.insufficientDataActions !== undefined) {
        insufficientDataActions.push(...defaults.insufficientDataActions);
      }
    }

    for (const rule of matched) {
      if (rule.alarmActions !== undefined) alarmActions.push(...rule.alarmActions);
      if (rule.okActions !== undefined) okActions.push(...rule.okActions);
      if (rule.insufficientDataActions !== undefined) {
        insufficientDataActions.push(...rule.insufficientDataActions);
      }
    }

    const uniqueAlarm = dedupe(alarmActions);
    const uniqueOk = dedupe(okActions);
    const uniqueInsufficient = dedupe(insufficientDataActions);

    if (uniqueAlarm.length > 0) alarm.addAlarmAction(...uniqueAlarm);
    if (uniqueOk.length > 0) alarm.addOkAction(...uniqueOk);
    if (uniqueInsufficient.length > 0) alarm.addInsufficientDataAction(...uniqueInsufficient);

    processed.add(alarm);
  });
}
