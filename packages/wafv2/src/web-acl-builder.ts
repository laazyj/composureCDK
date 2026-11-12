import { Annotations, Lazy } from "aws-cdk-lib";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import {
  type CfnLoggingConfiguration,
  CfnWebACL,
  type CfnWebACLAssociation,
  type CfnWebACLProps,
} from "aws-cdk-lib/aws-wafv2";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { associate, type WebAclAssociationTarget } from "./association.js";
import { type CustomResponse, CustomResponseBodies } from "./custom-response.js";
import {
  DEFAULT_RULE_PRIORITY_STEP,
  WEB_ACL_DEFAULTS,
  WEB_ACL_VISIBILITY_DEFAULTS,
} from "./defaults.js";
import {
  sanitizeMetricName,
  webAclBaseName,
  validateMetricName,
  validateRuleName,
  validateWebAclName,
} from "./names.js";
import {
  type BuiltRule,
  createWebAclRuleBuilder,
  type IWebAclRuleBuilder,
} from "./rule-builder.js";
import { configureLogging, type WebAclLoggingConfig } from "./logging.js";
import { checkCloudFrontRegion, type WebAclScope } from "./scope.js";

/**
 * Configuration for {@link createWebAclBuilder}: CDK's `CfnWebACLProps`, less
 * what the builder owns. Rules, the default action and associations have
 * their own methods; custom response bodies and the visibility config are
 * generated.
 */
export interface WebAclBuilderProps extends Omit<
  CfnWebACLProps,
  "scope" | "defaultAction" | "rules" | "customResponseBodies" | "visibilityConfig" | "tags"
> {
  /**
   * `REGIONAL` (the default) for API Gateway, Application Load Balancers,
   * AppSync, Cognito, App Runner and Verified Access; `CLOUDFRONT` for
   * CloudFront distributions, which must be deployed in `us-east-1`.
   */
  scope?: WebAclScope;

  /**
   * The name of the web ACL's CloudWatch metrics. Defaults to its `name` when
   * that is set, and otherwise to a name derived from its construct path, so
   * two web ACLs never share metrics.
   */
  metricName?: string;

  /**
   * Whether WAF keeps samples of the requests the web ACL and its rules
   * inspect. Off by default: samples keep every header, and logging's
   * redaction does not apply to them. Turning it on without a
   * `dataProtectionConfig` warns.
   */
  sampledRequests?: boolean;

  /**
   * The web ACL's logging. On by default, to a created `aws-waf-logs-`
   * CloudWatch log group, keeping only the requests WAF does not allow and
   * redacting the `authorization` and `cookie` headers. `false` turns it off.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  logging?: WebAclLoggingConfig | false;
}

/** The build output of an {@link IWebAclBuilder}. */
export interface WebAclBuilderResult {
  /** The web ACL. */
  webAcl: CfnWebACL;
  /**
   * One association per `associateWith` call, in that order. Empty for a
   * CLOUDFRONT web ACL, which a distribution references by `webAclId`.
   */
  associations: CfnWebACLAssociation[];
  /** The log group WAF writes to. Absent when logging is off or goes to your own destination. */
  logGroup?: LogGroup;
  /** The logging configuration. Absent when logging is off. */
  logging?: CfnLoggingConfiguration;
}

/**
 * A fluent builder for an AWS WAF web ACL.
 *
 * @see {@link createWebAclBuilder}
 */
export type IWebAclBuilder = ITaggedBuilder<WebAclBuilderProps, WebAclBuilder>;

interface RuleEntry {
  name: string;
  configure: (rule: IWebAclRuleBuilder) => IWebAclRuleBuilder;
}

interface DefaultAction {
  action: "allow" | "block";
  response?: CustomResponse;
}

const SAMPLING_ANNOTATION = "@composurecdk/wafv2:sampling-unredacted";
const MAX_RATE_BASED_RULES = 10;

class WebAclBuilder implements Lifecycle<WebAclBuilderResult> {
  props: Partial<WebAclBuilderProps> = {};
  readonly #rules: RuleEntry[] = [];
  readonly #associations: Resolvable<WebAclAssociationTarget>[] = [];
  #defaultAction: DefaultAction = { action: "allow" };

  /**
   * What happens to a request no rule decides on. `allow` is the default;
   * `block` can answer with a custom response.
   */
  defaultAction(action: "allow" | "block", response?: CustomResponse): this {
    if (action === "allow" && response !== undefined) {
      throw new Error(`defaultAction("allow") cannot take a custom response; only Block can.`);
    }
    this.#defaultAction = { action, response };
    return this;
  }

  /**
   * Adds a rule. Rules are evaluated in the order they are added, unless a
   * rule sets its own `.priority(n)`.
   *
   * @param name - Unique within the web ACL; also the rule's default metric name.
   * @param configure - Sets the rule's statement, action and the rest.
   */
  addRule(name: string, configure: (rule: IWebAclRuleBuilder) => IWebAclRuleBuilder): this {
    validateRuleName(name);
    if (this.#rules.some((r) => r.name === name)) {
      throw new Error(
        `WebAclBuilder.addRule: duplicate rule name "${name}". Each rule must have a unique name.`,
      );
    }
    this.#rules.push({ name, configure });
    return this;
  }

  /**
   * Protects a regional resource with this web ACL. Call it once per
   * resource. Accepts an ARN, a CDK reference CloudFormation's
   * `AWS::WAFv2::WebACLAssociation` takes (an Application Load Balancer, an
   * AppSync API), or an API Gateway stage, as a concrete value or a `ref`.
   *
   * A CLOUDFRONT web ACL cannot be associated: pass its ARN to the
   * distribution's `webAclId` instead.
   */
  associateWith(target: Resolvable<WebAclAssociationTarget>): this {
    this.#associations.push(target);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: WebAclBuilder): void {
    target.#rules.push(...this.#rules);
    target.#associations.push(...this.#associations);
    target.#defaultAction = this.#defaultAction;
  }

  build(scope: IConstruct, id: string, context: Record<string, object> = {}): WebAclBuilderResult {
    const owner = `WebAclBuilder "${id}"`;
    const {
      scope: aclScope = WEB_ACL_DEFAULTS.scope,
      metricName: userMetricName,
      sampledRequests = WEB_ACL_DEFAULTS.sampledRequests,
      logging: loggingConfig = WEB_ACL_DEFAULTS.logging,
      ...rest
    } = this.props;

    if (rest.name !== undefined) validateWebAclName(rest.name);
    if (aclScope === "CLOUDFRONT") {
      if (this.#associations.length > 0) {
        throw new Error(
          `${owner} has scope CLOUDFRONT, so it cannot be associated with associateWith(). ` +
            `Pass its ARN (result.webAcl.attrArn) to the distribution's webAclId instead.`,
        );
      }
      checkCloudFrontRegion(scope, id);
    }

    if (userMetricName !== undefined) validateMetricName(userMetricName);

    const bodies = new CustomResponseBodies(owner);
    const { action, response } = this.#defaultAction;
    const defaultAction: CfnWebACL.DefaultActionProperty =
      action === "allow"
        ? { allow: {} }
        : { block: bodies.block("default action", "DefaultAction", response) };
    const rules = this.#buildRules(owner, bodies, sampledRequests);
    const usesSampling = sampledRequests || rules.some((r) => r.sampled);
    // Read through `in`, not as a typed property: `dataProtectionConfig` is not in
    // CfnWebACLProps at this package's aws-cdk-lib floor (2.93.0), so it only
    // reaches `rest` as a pass-through prop on a newer install.
    const hasDataProtection =
      "dataProtectionConfig" in rest && rest.dataProtectionConfig !== undefined;
    if (usesSampling && !hasDataProtection) {
      Annotations.of(scope).addWarningV2(
        SAMPLING_ANNOTATION,
        `${owner} keeps sampled requests without a dataProtectionConfig. Samples keep every ` +
          `header and are not redacted by logging, so credentials in them are visible in the ` +
          `console. Set a dataProtectionConfig, or turn sampling off.`,
      );
    }

    const webAcl: CfnWebACL = new CfnWebACL(scope, id, {
      ...rest,
      scope: aclScope,
      defaultAction,
      rules: rules.map((r) => r.property),
      customResponseBodies: bodies.toProperty(),
      visibilityConfig: {
        ...WEB_ACL_VISIBILITY_DEFAULTS,
        // The derived name comes from the construct's path, so it is read once the construct exists.
        metricName:
          userMetricName ??
          Lazy.string({ produce: (): string => sanitizeMetricName(webAclBaseName(webAcl)) }),
        sampledRequestsEnabled: sampledRequests,
      },
    });

    const associations = associate(
      scope,
      id,
      webAcl.attrArn,
      this.#associations.map((target) => resolve(target, context)),
    );

    return {
      webAcl,
      associations,
      ...configureLogging(scope, id, owner, webAcl, loggingConfig, context),
    };
  }

  #buildRules(owner: string, bodies: CustomResponseBodies, sampledRequests: boolean): BuiltRule[] {
    const rules = this.#rules.map((entry, index) => {
      const builder = createWebAclRuleBuilder();
      entry.configure(builder);
      return builder.toRule({
        name: entry.name,
        owner,
        defaultPriority: index * DEFAULT_RULE_PRIORITY_STEP,
        sampledRequests,
        bodies,
      });
    });

    const byPriority = new Map<number, string>();
    for (const { property: rule } of rules) {
      const other = byPriority.get(rule.priority);
      if (other !== undefined) {
        throw new Error(
          `${owner}: rules "${other}" and "${rule.name}" both have priority ${String(rule.priority)}. ` +
            `Priorities must be unique; change one rule's .priority(n).`,
        );
      }
      byPriority.set(rule.priority, rule.name);
    }

    const rateBased = rules.filter((r) => r.rateBased);
    if (rateBased.length > MAX_RATE_BASED_RULES) {
      throw new Error(
        `${owner} has ${String(rateBased.length)} rate-based rules; AWS WAF allows at most ` +
          `${String(MAX_RATE_BASED_RULES)} per web ACL. See https://docs.aws.amazon.com/waf/latest/developerguide/limits.html.`,
      );
    }

    return rules;
  }
}

/**
 * Creates a builder for an AWS WAF web ACL, with its rules, its associations
 * and the visibility settings the rest of the package relies on.
 *
 * By default the web ACL is regional, allows what no rule blocks, publishes
 * CloudWatch metrics for itself and every rule ({@link WEB_ACL_VISIBILITY_DEFAULTS}),
 * and keeps no sampled requests ({@link WEB_ACL_DEFAULTS}).
 *
 * @example
 * ```ts
 * createWebAclBuilder()
 *   .associateWith(ref("api", (r: RestApiBuilderResult) => r.api.deploymentStage))
 *   .addRule("BlockAdmin", (rule) =>
 *     rule.statement({
 *       byteMatchStatement: {
 *         fieldToMatch: { uriPath: {} },
 *         positionalConstraint: "STARTS_WITH",
 *         searchString: "/admin",
 *         textTransformations: [{ priority: 0, type: "NONE" }],
 *       },
 *     }).respond(404));
 * ```
 */
export function createWebAclBuilder(): IWebAclBuilder {
  return taggedBuilder<WebAclBuilderProps, WebAclBuilder>(WebAclBuilder);
}
