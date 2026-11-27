import { Duration } from "aws-cdk-lib";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { Builder, COPY_STATE, type IBuilder, resolve, type Resolvable } from "@composurecdk/core";
import type {
  CustomResponse,
  CustomResponseBody,
  CustomResponseBodies,
} from "./custom-response.js";
import type { WebAclRuleAlarmConfig } from "./alarm-config.js";
import { WEB_ACL_VISIBILITY_DEFAULTS } from "./defaults.js";
import { validateMetricName, validateRuleLabel } from "./names.js";
import { type ManagedRuleGroupOptions, managedRuleGroupStatement } from "./managed-rule-groups.js";
import { fieldToMatch, type IpSetForwardedIpOptions, ruleStatements } from "./statements.js";
import {
  type ForwardedIpFallback,
  NO_TRANSFORMATION,
  type RateLimitAggregateKey,
  type RateLimitSpec,
  rateBasedStatement,
} from "./rate-limit.js";

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
  /** Resolves the refs a rule was given, such as an IP set's ARN. */
  readonly context: Record<string, object>;
  /** Adds a synth warning to the web ACL. */
  readonly warn: (id: string, message: string) => void;
}

/**
 * Where a rule's statement comes from: raw CloudFormation, or one of the
 * helpers, which are turned into CloudFormation at build.
 */
type StatementSource =
  | { readonly kind: "raw"; readonly statement: Resolvable<CfnWebACL.StatementProperty> }
  | { readonly kind: "rate"; readonly rate: RateLimitSpec }
  | {
      readonly kind: "managed";
      readonly name: string;
      readonly options: ManagedRuleGroupOptions;
    };

const UNKNOWN_OVERRIDE_ANNOTATION = "@composurecdk/wafv2:unknown-managed-rule";

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
  #statement?: StatementSource;
  readonly #aggregateKeys: RateLimitAggregateKey[] = [];
  #forwardedIpConfig?: CfnWebACL.ForwardedIPConfigurationProperty;
  #scopeDown?: Resolvable<CfnWebACL.StatementProperty>;
  #action?: WebAclRuleAction;
  #response?: CustomResponse;
  readonly #labels: string[] = [];

  /**
   * Sets the rule's statement: one of {@link ruleStatements}, or raw
   * CloudFormation for a statement they do not cover. Build a raw statement's
   * `fieldToMatch` with {@link fieldToMatch}: CDK passes several of its fields
   * through verbatim, so they need CloudFormation's PascalCase.
   *
   * A rule has exactly one statement; setting a second throws.
   */
  statement(statement: Resolvable<CfnWebACL.StatementProperty>): this {
    return this.#setStatement("statement", { kind: "raw", statement });
  }

  /**
   * Makes this a rate-based rule: matches the requests from each client — by
   * default each IP address — once it has sent more than `limit` in `window`,
   * until its rate falls back under the limit. Choose what identifies a
   * client with the `aggregateOn*` methods.
   *
   * A request missing any key it is aggregated on is not counted or limited,
   * so rate-limiting on a header needs a rule before it that blocks requests
   * without that header — see {@link blockUnlessHeader}.
   *
   * WAF applies and lifts the limit with a lag: in a sandbox test, about 25
   * seconds to start and about a minute to lift after traffic stopped, so a
   * new limit may not fire at once.
   *
   * @param limit - 10 to 2,000,000,000 requests.
   * @param window - 1, 2, 5 or 10 minutes. Defaults to 5.
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-request-limiting.html
   */
  rateLimit(limit: number, window: Duration = Duration.minutes(5)): this {
    return this.#setStatement("rateLimit", { kind: "rate", rate: { limit, window } });
  }

  /** Counts a rate-based rule's requests per client IP address. This is the default. */
  aggregateOnIp(): this {
    return this.aggregateOn({ ip: {} });
  }

  /**
   * Counts a rate-based rule's requests per client IP address as a proxy or
   * load balancer reports it, in a header such as `X-Forwarded-For`. WAF
   * skips requests without the header.
   *
   * @param headerName - The header that carries the client IP.
   * @param fallbackBehavior - What to do with a request whose header holds no
   *   valid IP address: `MATCH` limits it with the rest, `NO_MATCH` lets it by.
   */
  aggregateOnForwardedIp(headerName: string, fallbackBehavior: ForwardedIpFallback): this {
    if (this.#forwardedIpConfig !== undefined) {
      throw new Error(`aggregateOnForwardedIp(): the rule already aggregates on a forwarded IP.`);
    }
    this.#forwardedIpConfig = { headerName, fallbackBehavior };
    return this.aggregateOn({ forwardedIp: {} });
  }

  /**
   * Counts a rate-based rule's requests per value of a header, matched as
   * sent. For an API called with temporary AWS credentials,
   * `x-amz-security-token` limits each STS session separately.
   */
  aggregateOnHeader(name: string): this {
    return this.aggregateOn({ header: { name, textTransformations: [...NO_TRANSFORMATION] } });
  }

  /**
   * Counts a rate-based rule's requests per combination of these keys, as
   * CloudFormation's `RateBasedStatementCustomKey`: cookies, query arguments,
   * the query string, the URI path, the HTTP method, a label namespace and the
   * rest. Adds to any keys already set; at most five in all.
   */
  aggregateOn(...keys: RateLimitAggregateKey[]): this {
    this.#aggregateKeys.push(...keys);
    return this;
  }

  /**
   * Narrows a rate-based or managed rule group rule to the requests that match
   * `statement`, such as one of {@link ruleStatements}. A rate-based rule
   * counts only those requests; a rule group evaluates only them.
   */
  scopeDown(statement: Resolvable<CfnWebACL.StatementProperty>): this {
    this.#scopeDown = statement;
    return this;
  }

  /**
   * Matches requests that lack the header `name`, or send it empty. The match
   * on the name is not case-sensitive. The rule blocks by default; use
   * `.respond()` to answer with your own status, or `.count()` to try it out.
   *
   * WAF treats a request without the header as not matching a statement that
   * inspects it, so this is a `NotStatement` around a size check, which
   * matches exactly those requests.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-fields-list.html
   */
  blockUnlessHeader(name: string): this {
    return this.#setStatement("blockUnlessHeader", {
      kind: "raw",
      statement: {
        notStatement: {
          statement: ruleStatements.sizeConstraint(fieldToMatch.header(name), "GT", 0),
        },
      },
    });
  }

  /**
   * Evaluates a managed rule group, whose rules keep their own actions. Leave
   * the rule's action unset to apply them, or call `.count()` to count every
   * rule in the group instead, the way to try a group out before it blocks.
   *
   * AWS's groups are named in {@link AWS_MANAGED_RULE_GROUP_RULES}. No group is
   * added to a web ACL by default: each blocks some legitimate traffic until it
   * is tuned.
   *
   * @param name - The group's name, such as `AWSManagedRulesCommonRuleSet`.
   */
  managedRuleGroup<G extends string>(name: G, options: ManagedRuleGroupOptions<G> = {}): this {
    return this.#setStatement("managedRuleGroup", { kind: "managed", name, options });
  }

  /**
   * Matches requests from the addresses in an IP set: by its ARN, or a `ref`
   * to it, such as `ref("ips", (r) => r.attrArn)`. Use `.allow()` for an
   * allow-list; the rule blocks by default.
   *
   * @param forwardedIp - Match the address in a header, such as
   *   `X-Forwarded-For`, instead of the one the request came from.
   */
  ipSet(arn: Resolvable<string>, forwardedIp?: IpSetForwardedIpOptions): this {
    return this.#setStatement("ipSet", {
      kind: "raw",
      statement: ruleStatements.ipSet(arn, forwardedIp),
    });
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
    target.#aggregateKeys.push(...this.#aggregateKeys);
    target.#forwardedIpConfig = this.#forwardedIpConfig;
    target.#scopeDown = this.#scopeDown;
    target.#action = this.#action;
    target.#response = this.#response;
    target.#labels.push(...this.#labels);
  }

  #setStatement(method: string, source: StatementSource): this {
    if (this.#statement !== undefined) {
      throw new Error(
        `${method}(): the rule already has a statement. A rule has exactly one; combine conditions with an AndStatement or OrStatement.`,
      );
    }
    this.#statement = source;
    return this;
  }

  #buildStatement(ctx: RuleBuildContext, owner: string): CfnWebACL.StatementProperty {
    const source = this.#statement;
    if (source === undefined) {
      throw new Error(`${owner} has no statement. Give it one, such as .statement({ ... }).`);
    }
    if (source.kind !== "rate" && this.#aggregateKeys.length > 0) {
      throw new Error(
        `${owner} aggregates on keys, but is not rate-based. The aggregateOn* methods apply to rateLimit() rules only.`,
      );
    }
    if (source.kind === "raw" && this.#scopeDown !== undefined) {
      throw new Error(
        `${owner} has a scopeDown(), which applies to rateLimit() and managedRuleGroup() rules only.`,
      );
    }
    const scopeDown =
      this.#scopeDown === undefined ? undefined : resolve(this.#scopeDown, ctx.context);

    switch (source.kind) {
      case "raw":
        return resolve(source.statement, ctx.context);
      case "rate":
        return {
          rateBasedStatement: rateBasedStatement(
            owner,
            source.rate,
            { keys: this.#aggregateKeys, forwardedIpConfig: this.#forwardedIpConfig },
            scopeDown,
          ),
        };
      case "managed": {
        const { statement, unknownOverrides } = managedRuleGroupStatement(
          owner,
          source.name,
          source.options,
          scopeDown,
        );
        if (unknownOverrides.length > 0) {
          ctx.warn(
            UNKNOWN_OVERRIDE_ANNOTATION,
            `${owner} overrides ${unknownOverrides.map((r) => `"${r}"`).join(", ")}, which this ` +
              `package does not know as rules of ${source.name}. WAF silently ignores an override ` +
              `that matches no rule, case-sensitively; check the name against the group's rules.`,
          );
        }
        return { managedRuleGroupStatement: statement };
      }
    }
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
    const owner = `${ctx.owner} ${who}`;
    const statement = this.#buildStatement(ctx, owner);

    const metricName = this.props.metricName ?? ctx.name;
    validateMetricName(metricName);
    const sampled = this.props.sampledRequests ?? ctx.sampledRequests;
    const rateBased = statement.rateBasedStatement !== undefined;
    const ruleGroup = isRuleGroupStatement(statement);

    const { blocks, ...action } = this.#actionProperty(ctx, owner, who, ruleGroup, rateBased);
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
    owner: string,
    who: string,
    ruleGroup: boolean,
    rateBased: boolean,
  ): Pick<CfnWebACL.RuleProperty, "action" | "overrideAction"> & { blocks: boolean } {
    if (ruleGroup) {
      if (this.#action !== undefined && this.#action !== "count") {
        throw new Error(
          `${owner} evaluates a rule group, whose rules keep their own actions. ` +
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
        `${owner} is rate-based, and a rate-based rule cannot Allow. Use block, count, captcha or challenge.`,
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
