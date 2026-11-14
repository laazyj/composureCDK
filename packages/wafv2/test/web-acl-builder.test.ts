import { afterEach, describe, expect, it, vi } from "vitest";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import type { Stack } from "aws-cdk-lib";
import { MockIntegration, RestApi, type Stage } from "aws-cdk-lib/aws-apigateway";
import type { CfnWebACL, CfnWebACLProps } from "aws-cdk-lib/aws-wafv2";
import { buildFixture } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import {
  createWebAclBuilder,
  type IWebAclBuilder,
  type WebAclBuilderProps,
} from "../src/web-acl-builder.js";
import type { IWebAclRuleBuilder } from "../src/rule-builder.js";

const buildAndSynth = buildFixture(createWebAclBuilder, "Waf");

const PATH_STATEMENT: CfnWebACL.StatementProperty = {
  byteMatchStatement: {
    fieldToMatch: { uriPath: {} },
    positionalConstraint: "STARTS_WITH",
    searchString: "/admin",
    textTransformations: [{ priority: 0, type: "NONE" }],
  },
};

const RATE_STATEMENT: CfnWebACL.StatementProperty = {
  rateBasedStatement: { aggregateKeyType: "IP", limit: 100 },
};

const MANAGED_STATEMENT: CfnWebACL.StatementProperty = {
  managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" },
};

const pathRule = (rule: IWebAclRuleBuilder) => rule.statement(PATH_STATEMENT);

function rulesOf(webAcl: CfnWebACL): CfnWebACL.RuleProperty[] {
  return webAcl.rules as CfnWebACL.RuleProperty[];
}

function apiStage(stack: Stack): Stage {
  const api = new RestApi(stack, "Api");
  api.root.addMethod("GET", new MockIntegration());
  return api.deploymentStage;
}

describe("WebAclBuilder", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("defaults", () => {
    it("creates a regional web ACL that allows by default", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::WAFv2::WebACL", 1);
      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Scope: "REGIONAL",
        DefaultAction: { Allow: {} },
        Rules: [],
      });
    });

    it("publishes metrics and keeps no samples", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        VisibilityConfig: {
          CloudWatchMetricsEnabled: true,
          SampledRequestsEnabled: false,
          MetricName: Match.stringLikeRegexp("^[A-Za-z0-9_-]+$"),
        },
      });
    });

    it("derives distinct metric names for two unnamed web ACLs", () => {
      const { stack } = buildAndSynth();
      const first = createWebAclBuilder().build(stack, "First").webAcl;
      const second = createWebAclBuilder().build(stack, "Second").webAcl;

      const name = (acl: CfnWebACL) =>
        (acl.visibilityConfig as CfnWebACL.VisibilityConfigProperty).metricName;
      expect(name(first)).not.toEqual(name(second));
    });

    it("uses the web ACL's name as its metric name", () => {
      const { template } = buildAndSynth((b) => b.name("api-waf"));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Name: "api-waf",
        VisibilityConfig: Match.objectLike({ MetricName: "api-waf" }),
      });
    });

    it("prefers an explicit metric name", () => {
      const { template } = buildAndSynth((b) => b.name("api-waf").metricName("ApiWaf"));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        VisibilityConfig: Match.objectLike({ MetricName: "ApiWaf" }),
      });
    });

    it("emits no custom response bodies when none are used", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        CustomResponseBodies: Match.absent(),
      });
    });

    it("passes CfnWebACLProps through", () => {
      const { template } = buildAndSynth((b) =>
        b.description("Protects the API").tokenDomains(["example.com"]),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Description: "Protects the API",
        TokenDomains: ["example.com"],
      });
    });

    it("applies tags", () => {
      const { template } = buildAndSynth((b) => b.tag("team", "edge"));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Tags: [{ Key: "team", Value: "edge" }],
      });
    });

    it("accepts what CfnWebACLProps accepts for the pass-through props (type-level guard)", () => {
      const _props: Omit<WebAclBuilderProps, "scope" | "metricName" | "sampledRequests"> =
        undefined as unknown as Omit<
          CfnWebACLProps,
          "scope" | "defaultAction" | "rules" | "customResponseBodies" | "visibilityConfig" | "tags"
        >;
    });
  });

  describe("validation", () => {
    it("rejects an invalid web ACL name", () => {
      expect(() => buildAndSynth((b) => b.name("api waf"))).toThrow(/WebACL Name "api waf"/);
    });

    it("rejects a reserved metric name", () => {
      expect(() => buildAndSynth((b) => b.metricName("All"))).toThrow(/reserved by AWS WAF/);
    });

    it("rejects an invalid rule name when the rule is added", () => {
      expect(() => createWebAclBuilder().addRule("no spaces", pathRule)).toThrow(
        /Rule Name "no spaces"/,
      );
    });

    it("rejects a duplicate rule name when the rule is added", () => {
      const builder = createWebAclBuilder().addRule("Admin", pathRule);

      expect(() => builder.addRule("Admin", pathRule)).toThrow(/duplicate rule name "Admin"/);
    });
  });

  describe("default action", () => {
    it("blocks", () => {
      const { template } = buildAndSynth((b) => b.defaultAction("block"));

      template.hasResourceProperties("AWS::WAFv2::WebACL", { DefaultAction: { Block: {} } });
    });

    it("blocks with a custom response, hoisting its body", () => {
      const { template } = buildAndSynth((b) =>
        b.defaultAction("block", { status: 403, body: { text: "denied" } }),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        DefaultAction: {
          Block: { CustomResponse: { ResponseCode: 403, CustomResponseBodyKey: "DefaultAction" } },
        },
        CustomResponseBodies: {
          DefaultAction: { ContentType: "TEXT_PLAIN", Content: "denied" },
        },
      });
    });

    it("blocks with a custom response that has no body", () => {
      const { template } = buildAndSynth((b) => b.defaultAction("block", { status: 429 }));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        DefaultAction: { Block: { CustomResponse: { ResponseCode: 429 } } },
        CustomResponseBodies: Match.absent(),
      });
    });

    it("can be set back to allow", () => {
      const { template } = buildAndSynth((b) => b.defaultAction("block").defaultAction("allow"));

      template.hasResourceProperties("AWS::WAFv2::WebACL", { DefaultAction: { Allow: {} } });
    });

    it("rejects a custom response on allow", () => {
      expect(() => createWebAclBuilder().defaultAction("allow", { status: 200 })).toThrow(
        /only Block can/,
      );
    });
  });

  describe("rules", () => {
    it("emits a rule with its statement, a Block action and metrics", () => {
      const { template } = buildAndSynth((b) => b.addRule("BlockAdmin", pathRule));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          {
            Name: "BlockAdmin",
            Priority: 0,
            Statement: {
              ByteMatchStatement: Match.objectLike({ SearchString: "/admin" }),
            },
            Action: { Block: {} },
            VisibilityConfig: {
              CloudWatchMetricsEnabled: true,
              MetricName: "BlockAdmin",
              SampledRequestsEnabled: false,
            },
          },
        ],
      });
    });

    it("passes any-typed statement fields through verbatim", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("ApiKey", (r) =>
          r.statement({
            sizeConstraintStatement: {
              fieldToMatch: { singleHeader: { Name: "x-api-key" } },
              comparisonOperator: "GT",
              size: 0,
              textTransformations: [{ priority: 0, type: "NONE" }],
            },
          }),
        ),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            Statement: {
              SizeConstraintStatement: Match.objectLike({
                FieldToMatch: { SingleHeader: { Name: "x-api-key" } },
              }),
            },
          }),
        ],
      });
    });

    it("prioritises rules in the order they are added, ten apart", () => {
      const { result } = buildAndSynth((b) =>
        b.addRule("First", pathRule).addRule("Second", pathRule).addRule("Third", pathRule),
      );

      expect(rulesOf(result.webAcl).map((r) => [r.name, r.priority])).toEqual([
        ["First", 0],
        ["Second", 10],
        ["Third", 20],
      ]);
    });

    it("lets a rule set its own priority", () => {
      const { result } = buildAndSynth((b) =>
        b.addRule("First", pathRule).addRule("Inserted", (r) => pathRule(r).priority(5)),
      );

      expect(rulesOf(result.webAcl).map((r) => r.priority)).toEqual([0, 5]);
    });

    it("rejects two rules with the same priority, naming both", () => {
      expect(() =>
        buildAndSynth((b) =>
          b.addRule("First", pathRule).addRule("Second", (r) => pathRule(r).priority(0)),
        ),
      ).toThrow(/rules "First" and "Second" both have priority 0/);
    });

    it("rejects a rule without a statement", () => {
      expect(() => buildAndSynth((b) => b.addRule("Empty", (r) => r.block()))).toThrow(
        /rule "Empty" has no statement/,
      );
    });

    it("rejects a second statement", () => {
      expect(() =>
        buildAndSynth((b) => b.addRule("Two", (r) => pathRule(r).statement(PATH_STATEMENT))),
      ).toThrow(/already has a statement/);
    });

    it.each([
      ["allow", { Allow: {} }],
      ["count", { Count: {} }],
      ["captcha", { Captcha: {} }],
      ["challenge", { Challenge: {} }],
      ["block", { Block: {} }],
    ] as const)("emits the %s action", (action, expected) => {
      const { template } = buildAndSynth((b) => b.addRule("Rule", (r) => pathRule(r)[action]()));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [Match.objectLike({ Action: expected })],
      });
    });

    it("uses an explicit metric name for a rule", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Rule", (r) => pathRule(r).metricName("AdminPath")),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({ VisibilityConfig: Match.objectLike({ MetricName: "AdminPath" }) }),
        ],
      });
    });

    it("rejects a reserved rule metric name", () => {
      expect(() =>
        buildAndSynth((b) => b.addRule("Rule", (r) => pathRule(r).metricName("Default_Action"))),
      ).toThrow(/reserved by AWS WAF/);
    });

    it("adds labels", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Rule", (r) => pathRule(r).count().labels("admin:path", "probe")),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [Match.objectLike({ RuleLabels: [{ Name: "admin:path" }, { Name: "probe" }] })],
      });
    });

    it("passes rule CAPTCHA and challenge configs through", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Rule", (r) =>
          pathRule(r)
            .captcha()
            .captchaConfig({ immunityTimeProperty: { immunityTime: 60 } })
            .challengeConfig({ immunityTimeProperty: { immunityTime: 120 } }),
        ),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            CaptchaConfig: { ImmunityTimeProperty: { ImmunityTime: 60 } },
            ChallengeConfig: { ImmunityTimeProperty: { ImmunityTime: 120 } },
          }),
        ],
      });
    });

    it.each([
      ["aws:thing", /reserves/],
      ["bad label", /rule label part/],
      ["a:b:c:d:e:f:g", /6 namespaces; at most 5/],
    ])("rejects the label %s", (label, error) => {
      expect(() => buildAndSynth((b) => b.addRule("Rule", (r) => r.labels(label)))).toThrow(error);
    });

    it("rejects Allow on a rate-based rule", () => {
      expect(() =>
        buildAndSynth((b) => b.addRule("Rate", (r) => r.statement(RATE_STATEMENT).allow())),
      ).toThrow(/rate-based rule cannot Allow/);
    });

    it("rejects more than ten rate-based rules", () => {
      expect(() =>
        buildAndSynth((b) => {
          for (let i = 0; i < 11; i++)
            b.addRule(`Rate${String(i)}`, (r) => r.statement(RATE_STATEMENT));
        }),
      ).toThrow(/11 rate-based rules; AWS WAF allows at most 10/);
    });

    it("samples a rule when the rule asks", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Rule", (r) => pathRule(r).sampledRequests(true)),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            VisibilityConfig: Match.objectLike({ SampledRequestsEnabled: true }),
          }),
        ],
        VisibilityConfig: Match.objectLike({ SampledRequestsEnabled: false }),
      });
    });
  });

  describe("rule groups", () => {
    it("emits overrideAction None instead of an action", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Common", (r) => r.statement(MANAGED_STATEMENT)),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [Match.objectLike({ OverrideAction: { None: {} }, Action: Match.absent() })],
      });
    });

    it("counts the whole group with .count()", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Common", (r) => r.statement(MANAGED_STATEMENT).count()),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [Match.objectLike({ OverrideAction: { Count: {} } })],
      });
    });

    it("treats a rule group reference the same way", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Mine", (r) =>
          r.statement({
            ruleGroupReferenceStatement: {
              arn: "arn:aws:wafv2:eu-west-2:1:regional/rulegroup/x/y",
            },
          }),
        ),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [Match.objectLike({ OverrideAction: { None: {} } })],
      });
    });

    it("rejects any other action", () => {
      expect(() =>
        buildAndSynth((b) => b.addRule("Common", (r) => r.statement(MANAGED_STATEMENT).block())),
      ).toThrow(/evaluates a rule group/);
    });
  });

  describe("custom responses", () => {
    const throttled = { json: { reason: "throttled" } };

    it("hoists a rule's body to the web ACL, keyed by the rule name", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("Throttle", (r) =>
          r.statement(RATE_STATEMENT).respond(429, throttled, { "Retry-After": "60" }),
        ),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            Action: {
              Block: {
                CustomResponse: {
                  ResponseCode: 429,
                  CustomResponseBodyKey: "Throttle",
                  ResponseHeaders: [{ Name: "Retry-After", Value: "60" }],
                },
              },
            },
          }),
        ],
        CustomResponseBodies: {
          Throttle: { ContentType: "APPLICATION_JSON", Content: '{"reason":"throttled"}' },
        },
      });
    });

    it("shares one key between identical bodies", () => {
      const { result } = buildAndSynth((b) =>
        b
          .addRule("First", (r) => r.statement(RATE_STATEMENT).respond(429, throttled))
          .addRule("Second", (r) => r.statement(RATE_STATEMENT).respond(429, throttled)),
      );

      expect(Object.keys(result.webAcl.customResponseBodies ?? {})).toEqual(["First"]);
      const keys = rulesOf(result.webAcl).map(
        (r) =>
          ((r.action as CfnWebACL.RuleActionProperty).block as CfnWebACL.BlockActionProperty)
            .customResponse as CfnWebACL.CustomResponseProperty,
      );
      expect(keys.map((k) => k.customResponseBodyKey)).toEqual(["First", "First"]);
    });

    it("suffixes a key another body already took", () => {
      const { result } = buildAndSynth((b) =>
        b
          .defaultAction("block", { status: 403, body: { text: "a" } })
          .addRule("DefaultAction", (r) => pathRule(r).respond(403, { text: "b" })),
      );

      expect(result.webAcl.customResponseBodies).toEqual({
        DefaultAction: { contentType: "TEXT_PLAIN", content: "a" },
        "DefaultAction-2": { contentType: "TEXT_PLAIN", content: "b" },
      });
    });

    it("emits html and pre-serialised json bodies", () => {
      const { result } = buildAndSynth((b) =>
        b
          .addRule("Html", (r) => pathRule(r).respond(403, { html: "<p>no</p>" }))
          .addRule("Json", (r) => pathRule(r).respond(403, { json: '{"a":1}' })),
      );

      expect(result.webAcl.customResponseBodies).toEqual({
        Html: { contentType: "TEXT_HTML", content: "<p>no</p>" },
        Json: { contentType: "APPLICATION_JSON", content: '{"a":1}' },
      });
    });

    it.each([410, 402, 418])("rejects status %i", (status) => {
      expect(() =>
        buildAndSynth((b) => b.addRule("Rule", (r) => pathRule(r).respond(status))),
      ).toThrow(new RegExp(`status code ${String(status)}`));
    });

    it("rejects a body over 4 KB", () => {
      expect(() =>
        buildAndSynth((b) =>
          b.addRule("Rule", (r) => pathRule(r).respond(403, { text: "x".repeat(4097) })),
        ),
      ).toThrow(/4097 bytes; AWS WAF allows at most 4096/);
    });

    it("rejects more than 50 KB of bodies", () => {
      expect(() =>
        buildAndSynth((b) => {
          for (let i = 0; i < 13; i++) {
            b.addRule(`Rule${String(i)}`, (r) =>
              pathRule(r).respond(403, { text: String(i).padEnd(4000, "x") }),
            );
          }
        }),
      ).toThrow(/total \d+ bytes; AWS WAF allows at most 51200/);
    });

    it("rejects more than 50 bodies", () => {
      expect(() =>
        buildAndSynth((b) => {
          for (let i = 0; i < 51; i++) {
            b.addRule(`Rule${String(i)}`, (r) => pathRule(r).respond(403, { text: String(i) }));
          }
        }),
      ).toThrow(/at most 50 distinct custom response bodies/);
    });

    it("rejects more than ten headers", () => {
      const headers = Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`x-h${String(i)}`, "v"]),
      );
      expect(() =>
        buildAndSynth((b) =>
          b.addRule("Rule", (r) => pathRule(r).respond(403, undefined, headers)),
        ),
      ).toThrow(/at most 10 headers/);
    });

    it.each([
      ["content-type", /cannot set content-type/],
      ["Content-Type", /cannot set content-type/],
      ["bad header", /header "bad header" is invalid/],
    ])("rejects the header %s", (name, error) => {
      expect(() =>
        buildAndSynth((b) =>
          b.addRule("Rule", (r) => pathRule(r).respond(403, undefined, { [name]: "v" })),
        ),
      ).toThrow(error);
    });

    it("rejects a header set twice in different case", () => {
      expect(() =>
        buildAndSynth((b) =>
          b.addRule("Rule", (r) => pathRule(r).respond(403, undefined, { "x-a": "1", "X-A": "2" })),
        ),
      ).toThrow(/set twice/);
    });

    it("rejects respond() after a non-Block action", () => {
      expect(() =>
        buildAndSynth((b) => b.addRule("R", (r) => pathRule(r).count().respond(429))),
      ).toThrow(/only available on Block/);
    });

    it("rejects a non-Block action after respond()", () => {
      expect(() =>
        buildAndSynth((b) => b.addRule("R", (r) => pathRule(r).respond(429).count())),
      ).toThrow(/only applies to Block/);
    });

    it("allows block() after respond()", () => {
      const { template } = buildAndSynth((b) =>
        b.addRule("R", (r) => pathRule(r).respond(429).block()),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [Match.objectLike({ Action: { Block: { CustomResponse: { ResponseCode: 429 } } } })],
      });
    });
  });

  describe("sampling", () => {
    it("samples when asked, and warns without a dataProtectionConfig", () => {
      const { template, stack } = buildAndSynth((b) =>
        b.sampledRequests(true).addRule("R", pathRule),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        VisibilityConfig: Match.objectLike({ SampledRequestsEnabled: true }),
        Rules: [
          Match.objectLike({
            VisibilityConfig: Match.objectLike({ SampledRequestsEnabled: true }),
          }),
        ],
      });
      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp("sampled requests without a dataProtectionConfig"),
      );
    });

    it("warns when only a rule samples", () => {
      const { stack } = buildAndSynth((b) =>
        b.addRule("R", (r) => pathRule(r).sampledRequests(true)),
      );

      Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp("sampled requests"));
    });

    it("does not warn with a dataProtectionConfig", () => {
      // `dataProtectionConfig` is not in CfnWebACLProps at the 2.93.0 floor, so it is
      // set through the builder's untyped prop setter to keep the suite typechecking there.
      const { stack } = buildAndSynth((b) =>
        (
          b.sampledRequests(true) as unknown as {
            dataProtectionConfig(value: unknown): IWebAclBuilder;
          }
        ).dataProtectionConfig({
          dataProtections: [
            {
              action: "SUBSTITUTION",
              field: { fieldType: "SINGLE_HEADER", fieldKeys: ["authorization"] },
            },
          ],
        }),
      );

      Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
    });

    it("does not warn by default", () => {
      const { stack } = buildAndSynth((b) => b.addRule("R", pathRule));

      Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
    });
  });

  describe("associations", () => {
    it("creates none by default", () => {
      const { result, template } = buildAndSynth();

      expect(result.associations).toEqual([]);
      template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 0);
    });

    it("associates an ARN, referencing the web ACL by GetAtt", () => {
      const { template, result } = buildAndSynth((b) =>
        b.associateWith("arn:aws:elasticloadbalancing:eu-west-2:1:loadbalancer/app/x/y"),
      );

      expect(result.associations).toHaveLength(1);
      template.hasResourceProperties("AWS::WAFv2::WebACLAssociation", {
        ResourceArn: "arn:aws:elasticloadbalancing:eu-west-2:1:loadbalancer/app/x/y",
        WebACLArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Waf"), "Arn"] },
      });
    });

    it("associates an API Gateway stage by its ARN, which references the stage", () => {
      const { template } = buildAndSynth((b, stack) => b.associateWith(apiStage(stack)));

      template.hasResourceProperties("AWS::WAFv2::WebACLAssociation", {
        ResourceArn: {
          "Fn::Join": [
            "",
            Match.arrayWith([{ Ref: Match.stringLikeRegexp("^ApiDeploymentStageprod") }]),
          ],
        },
      });
      template.hasResource("AWS::WAFv2::WebACLAssociation", {
        DependsOn: Match.arrayWith([Match.stringLikeRegexp("^ApiDeploymentStageprod")]),
      });
    });

    it("resolves a ref to the target", () => {
      const context: Record<string, object> = {};
      const { template } = buildAndSynth(
        (b, stack) => {
          context.api = { stage: apiStage(stack) };
          b.associateWith(ref("api", (r: { stage: Stage }) => r.stage));
        },
        { context },
      );

      template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
    });

    it("chains several associations so they are created one at a time", () => {
      const { result } = buildAndSynth((b) =>
        b.associateWith("arn:aws:a").associateWith("arn:aws:b").associateWith("arn:aws:c"),
      );

      const [a, b, c] = result.associations;
      expect(b.node.dependencies.includes(a)).toBe(true);
      expect(c.node.dependencies.includes(b)).toBe(true);
      expect(a.node.dependencies).toHaveLength(0);
    });

    it("keys an association by its target, not its position", () => {
      const ids = (targets: string[]) =>
        buildAndSynth((b) => {
          for (const t of targets) b.associateWith(t);
        }).result.associations.map((a) => a.node.id);

      const [, second] = ids(["arn:aws:a", "arn:aws:b"]);
      expect(ids(["arn:aws:b"])).toEqual([second]);
    });

    it("rejects the same target twice", () => {
      expect(() =>
        buildAndSynth((b) => b.associateWith("arn:aws:a").associateWith("arn:aws:a")),
      ).toThrow(/same resource twice/);
    });
  });

  describe("CLOUDFRONT scope", () => {
    it("builds in us-east-1", () => {
      const { template } = buildAndSynth((b) => b.scope("CLOUDFRONT"), {
        stackProps: { env: { region: "us-east-1" } },
      });

      template.hasResourceProperties("AWS::WAFv2::WebACL", { Scope: "CLOUDFRONT" });
    });

    it("throws in another region", () => {
      expect(() =>
        buildAndSynth((b) => b.scope("CLOUDFRONT"), {
          stackProps: { env: { region: "eu-west-2" } },
        }),
      ).toThrow(/stack is in "eu-west-2"/);
    });

    it("checks CDK_DEFAULT_REGION for an env-agnostic stack", () => {
      vi.stubEnv("CDK_DEFAULT_REGION", "eu-west-1");

      expect(() => buildAndSynth((b) => b.scope("CLOUDFRONT"))).toThrow(/stack is in "eu-west-1"/);
    });

    it("warns when the region cannot be known", () => {
      vi.stubEnv("CDK_DEFAULT_REGION", "");
      const { stack } = buildAndSynth((b) => b.scope("CLOUDFRONT"));

      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp("only accepts in us-east-1"),
      );
    });

    it("rejects associateWith", () => {
      expect(() =>
        buildAndSynth((b) => b.scope("CLOUDFRONT").associateWith("arn:aws:a"), {
          stackProps: { env: { region: "us-east-1" } },
        }),
      ).toThrow(/cannot be associated/);
    });
  });

  describe("copy", () => {
    it("preserves rules, associations and the default action", () => {
      assertCopyPreservesState({
        factory: createWebAclBuilder,
        configure: (b) => {
          b.addRule("First", pathRule).associateWith("arn:aws:a").defaultAction("block");
        },
        mutate: (b) => {
          b.addRule("Second", pathRule).associateWith("arn:aws:b").defaultAction("allow");
        },
        build: (b) => buildFixture(() => b, "Waf")().result,
        inspect: (result) => {
          return {
            rules: rulesOf(result.webAcl).map((r) => r.name),
            associations: result.associations.length,
            defaultAction: result.webAcl.defaultAction,
          };
        },
      });
    });
  });
});
