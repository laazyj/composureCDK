import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { Builder, COPY_STATE, type IBuilder } from "@composurecdk/core";
import type {
  CustomResponse,
  CustomResponseBody,
  CustomResponseBodies,
} from "./custom-response.js";
import type { WebAclRuleAlarmConfig } from "./alarm-config.js";
import { WEB_ACL_VISIBILITY_DEFAULTS } from "./defaults.js";
import { validateMetricName, validateRuleLabel } from "./names.js";

/** The action a rule takes on a request that matches its statement. */
export type WebAclRuleAction = "block" | "allow" | "count" | "captcha" | "challenge";

/**
 * Configuration for one rule in a web ACL. The statement, action, custom
 * response and labels are set with the builder's methods; these are the rest.
 */
export interface WebAclRuleBuilderProps {
  /**
   * The rule's priority. WAF evaluates rules from the lowest priority up.
   * Defaults to ten times the rule's position in `addRule` order, so rules
   * run in the order they are declared. Must be unique within the web ACL.
   */
  priority?: number;

  /**
   * The name of the rule's CloudWatch metrics. Defaults to the rule's name.
   */
  metricName?: string;

  /**
   * Whether WAF keeps a sample of the requests this rule matches. Defaults to
   * the web ACL's `sampledRequests`, which is off.
   */
  sampledRequests?: boolean;

  /** CAPTCHA immunity for this rule, overriding the web ACL's. */
  captchaConfig?: CfnWebACL.RuleProperty["captchaConfig"];

  /** Challenge immunity for this rule, overriding the web ACL's. */
  challengeConfig?: CfnWebACL.RuleProperty["challengeConfig"];

  /**
   * This rule's recommended alarms: a `BlockedRequests` alarm, on by default
   * for a rule you wrote that blocks and opt-in for a rule-group rule, and a
   * `DaysToExpiry` alarm for a pinned managed rule group version. `false`
   * disables both.
   */
  alarms?: WebAclRuleAlarmConfig | false;
}

/** What the web ACL builder knows when it turns a rule into CloudFormation. */
export interface RuleBuildContext {
  /** The rule's name, as given to `addRule`. */
  readonly name: string;
  /** Names the web ACL in error messages. */
  readonly owner: string;
  /** The priority to use unless the rule sets its own. */
  readonly defaultPriority: number;
  /** The web ACL's sampling setting, which the rule inherits. */
  readonly sampledRequests: boolean;
  /** Where custom response bodies are collected. */
  readonly bodies: CustomResponseBodies;
}

/** A rule turned into CloudFormation, with what the web ACL needs to know about it. */
export interface BuiltRule {
  readonly property: CfnWebACL.RuleProperty & { readonly priority: number };
  /** The rule's CloudWatch metric name: the `Rule` dimension of its metrics. */
  readonly metricName: string;
  readonly sampled: boolean;
  readonly rateBased: boolean;
  /** Whether the rule evaluates a rule group, so takes `overrideAction`. */
  readonly ruleGroup: boolean;
  /** Whether matching requests are blocked: by the rule, or by a rule group's own rules. */
  readonly blocks: boolean;
  /** The rule's recommended alarm configuration. */
  readonly alarms: WebAclRuleAlarmConfig | false | undefined;
}

const RULE_GROUP_STATEMENTS = ["managedRuleGroupStatement", "ruleGroupReferenceStatement"] as const;

/** Whether `statement` evaluates a rule group, so its rule takes `overrideAction`. */
function isRuleGroupStatement(statement: CfnWebACL.StatementProperty): boolean {
  return RULE_GROUP_STATEMENTS.some((key) => statement[key] !== undefined);
}

class WebAclRuleBuilder {
  props: Partial<WebAclRuleBuilderProps> = {};
  #statement?: CfnWebACL.StatementProperty;
  #action?: WebAclRuleAction;
  #response?: CustomResponse;
  readonly #labels: string[] = [];

  /**
   * Sets the rule's statement as raw CloudFormation, for a statement this
   * builder has no helper for. Fields CDK types as `any` — `singleHeader`,
   * `queryString`, `uriPath`, `method` and the like — pass through verbatim,
   * so they must use CloudFormation's PascalCase (`{ Name: "x-api-key" }`).
   *
   * A rule has exactly one statement; setting a second throws.
   */
  statement(statement: CfnWebACL.StatementProperty): this {
    this.#setStatement("statement", statement);
    return this;
  }

  /** Blocks matching requests. This is the default action. */
  block(): this {
    return this.#setAction("block");
  }

  /** Allows matching requests, ending evaluation of the web ACL. */
  allow(): this {
    return this.#setAction("allow");
  }

  /**
   * Counts matching requests and carries on evaluating. On a rule-group rule
   * this counts every rule in the group instead of applying its actions.
   */
  count(): this {
    return this.#setAction("count");
  }

  /** Answers matching requests with a CAPTCHA puzzle. */
  captcha(): this {
    return this.#setAction("captcha");
  }

  /** Answers matching requests with a silent browser challenge. */
  challenge(): this {
    return this.#setAction("challenge");
  }

  /**
   * Blocks matching requests with a custom response instead of WAF's `403`.
   * The body is collected into the web ACL's `customResponseBodies`, so
   * nothing has to be declared there by hand.
   *
   * @param status - One of the status codes WAF supports; `410` is not.
   * @param body - `{ json }`, `{ text }` or `{ html }`; at most 4 KB.
   * @param headers - At most 10, and not `content-type`.
   */
  respond(status: number, body?: CustomResponseBody, headers?: Record<string, string>): this {
    if (this.#action !== undefined && this.#action !== "block") {
      throw new Error(
        `respond() blocks the request, but the rule's action is already "${this.#action}". A custom response is only available on Block.`,
      );
    }
    this.#action = "block";
    this.#response = { status, body, headers };
    return this;
  }

  /**
   * Adds labels to matching requests, for later rules to match on with a
   * label match statement. Give the namespaces and name only, such as
   * `"auth:missing-token"`; WAF adds the web ACL prefix.
   */
  labels(...labels: string[]): this {
    for (const label of labels) validateRuleLabel(label);
    this.#labels.push(...labels);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: WebAclRuleBuilder): void {
    target.#statement = this.#statement;
    target.#action = this.#action;
    target.#response = this.#response;
    target.#labels.push(...this.#labels);
  }

  #setStatement(method: string, statement: CfnWebACL.StatementProperty): void {
    if (this.#statement !== undefined) {
      throw new Error(
        `${method}(): the rule already has a statement. A rule has exactly one; combine conditions with an AndStatement or OrStatement.`,
      );
    }
    this.#statement = statement;
  }

  #setAction(action: WebAclRuleAction): this {
    if (this.#response !== undefined && action !== "block") {
      throw new Error(
        `${action}(): the rule already has a custom response from respond(), which only applies to Block.`,
      );
    }
    this.#action = action;
    return this;
  }

  /** @internal — the web ACL builder turns each rule into CloudFormation. */
  toRule(ctx: RuleBuildContext): BuiltRule {
    const who = `rule "${ctx.name}"`;
    const statement = this.#statement;
    if (statement === undefined) {
      throw new Error(
        `${ctx.owner} ${who} has no statement. Give it one, such as .statement({ ... }).`,
      );
    }

    const metricName = this.props.metricName ?? ctx.name;
    validateMetricName(metricName);
    const sampled = this.props.sampledRequests ?? ctx.sampledRequests;
    const rateBased = statement.rateBasedStatement !== undefined;
    const ruleGroup = isRuleGroupStatement(statement);

    const { blocks, ...action } = this.#actionProperty(ctx, who, ruleGroup, rateBased);
    const property = {
      name: ctx.name,
      priority: this.props.priority ?? ctx.defaultPriority,
      statement,
      ...action,
      visibilityConfig: {
        ...WEB_ACL_VISIBILITY_DEFAULTS,
        metricName,
        sampledRequestsEnabled: sampled,
      },
      ...(this.#labels.length > 0 && { ruleLabels: this.#labels.map((name) => ({ name })) }),
      ...(this.props.captchaConfig && { captchaConfig: this.props.captchaConfig }),
      ...(this.props.challengeConfig && { challengeConfig: this.props.challengeConfig }),
    };
    return {
      property,
      metricName,
      sampled,
      rateBased,
      ruleGroup,
      blocks,
      alarms: this.props.alarms,
    };
  }

  #actionProperty(
    ctx: RuleBuildContext,
    who: string,
    ruleGroup: boolean,
    rateBased: boolean,
  ): Pick<CfnWebACL.RuleProperty, "action" | "overrideAction"> & { blocks: boolean } {
    if (ruleGroup) {
      if (this.#action !== undefined && this.#action !== "count") {
        throw new Error(
          `${ctx.owner} ${who} evaluates a rule group, whose rules keep their own actions. ` +
            `Use .count() to count them all instead, or leave the action unset.`,
        );
      }
      // The group's own rules block unless the whole group is counted.
      return this.#action === "count"
        ? { overrideAction: { count: {} }, blocks: false }
        : { overrideAction: { none: {} }, blocks: true };
    }

    const action = this.#action ?? "block";
    if (action === "allow" && rateBased) {
      throw new Error(
        `${ctx.owner} ${who} is rate-based, and a rate-based rule cannot Allow. Use block, count, captcha or challenge.`,
      );
    }
    if (action !== "block") return { action: { [action]: {} }, blocks: false };
    return { action: { block: ctx.bodies.block(who, ctx.name, this.#response) }, blocks: true };
  }
}

// eslint-disable-next-line composurecdk/builder-must-be-tagged -- a rule is a property of AWS::WAFv2::WebACL, not a taggable resource
type FullWebAclRuleBuilder = IBuilder<WebAclRuleBuilderProps, WebAclRuleBuilder>;

/**
 * Fluent configuration for one rule in a web ACL, passed to the callback of
 * {@link IWebAclBuilder.addRule}.
 */
export type IWebAclRuleBuilder = Omit<FullWebAclRuleBuilder, "toRule">;

/** @internal — the web ACL builder makes one of these per rule. */
export function createWebAclRuleBuilder(): FullWebAclRuleBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- a rule is a property of AWS::WAFv2::WebACL, not a taggable resource
  return Builder<WebAclRuleBuilderProps, WebAclRuleBuilder>(WebAclRuleBuilder);
}
