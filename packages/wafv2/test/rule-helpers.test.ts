import { describe, expect, it } from "vitest";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Duration, Lazy } from "aws-cdk-lib";
import { type CfnWebACL, CfnIPSet } from "aws-cdk-lib/aws-wafv2";
import { buildFixture } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createWebAclBuilder } from "../src/web-acl-builder.js";
import type { IWebAclRuleBuilder } from "../src/rule-builder.js";

const buildAndSynth = buildFixture(createWebAclBuilder, "Waf");

const IP_SET_ARN = "arn:aws:wafv2:us-east-1:123456789012:regional/ipset/office/abc";

const ADMIN_PATH = {
  byteMatchStatement: {
    fieldToMatch: { uriPath: {} },
    positionalConstraint: "STARTS_WITH",
    searchString: "/admin",
    textTransformations: [{ priority: 0, type: "NONE" }],
  },
};

/** Synthesises a web ACL with one rule, configured by `configure`. */
const withRule = (configure: (rule: IWebAclRuleBuilder) => IWebAclRuleBuilder) =>
  buildAndSynth((b) => b.addRule("Rule", configure));

const ruleStatement = (statement: Record<string, unknown>) => ({
  Rules: [Match.objectLike({ Statement: statement })],
});

describe("rule helpers", () => {
  describe("rateLimit", () => {
    it("limits per IP over five minutes by default", () => {
      const { template } = withRule((r) => r.rateLimit(100));

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          RateBasedStatement: { Limit: 100, EvaluationWindowSec: 300, AggregateKeyType: "IP" },
        }),
      );
    });

    it("sets the window and blocks", () => {
      const { template } = withRule((r) => r.rateLimit(60, Duration.minutes(1)));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            Action: { Block: {} },
            Statement: { RateBasedStatement: Match.objectLike({ EvaluationWindowSec: 60 }) },
          }),
        ],
      });
    });

    it("uses IP for an explicit IP aggregation", () => {
      const { template } = withRule((r) => r.rateLimit(100).aggregateOnIp());

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          RateBasedStatement: Match.objectLike({
            AggregateKeyType: "IP",
            CustomKeys: Match.absent(),
          }),
        }),
      );
    });

    it("uses FORWARDED_IP for a forwarded IP alone", () => {
      const { template } = withRule((r) =>
        r.rateLimit(100).aggregateOnForwardedIp("X-Forwarded-For", "MATCH"),
      );

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          RateBasedStatement: Match.objectLike({
            AggregateKeyType: "FORWARDED_IP",
            ForwardedIPConfig: { HeaderName: "X-Forwarded-For", FallbackBehavior: "MATCH" },
            CustomKeys: Match.absent(),
          }),
        }),
      );
    });

    it("aggregates on a header with CUSTOM_KEYS", () => {
      const { template } = withRule((r) =>
        r.rateLimit(60, Duration.minutes(1)).aggregateOnHeader("x-amz-security-token"),
      );

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          RateBasedStatement: Match.objectLike({
            AggregateKeyType: "CUSTOM_KEYS",
            CustomKeys: [
              {
                Header: {
                  Name: "x-amz-security-token",
                  TextTransformations: [{ Priority: 0, Type: "NONE" }],
                },
              },
            ],
          }),
        }),
      );
    });

    it("combines an IP with other keys as custom keys", () => {
      const { template } = withRule((r) =>
        r.rateLimit(100).aggregateOnIp().aggregateOn({ httpMethod: {} }),
      );

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          RateBasedStatement: Match.objectLike({
            AggregateKeyType: "CUSTOM_KEYS",
            CustomKeys: [{ IP: {} }, { HTTPMethod: {} }],
          }),
        }),
      );
    });

    it("scopes down", () => {
      const { template } = withRule((r) => r.rateLimit(100).scopeDown(ADMIN_PATH));

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          RateBasedStatement: Match.objectLike({
            ScopeDownStatement: {
              ByteMatchStatement: Match.objectLike({ SearchString: "/admin" }),
            },
          }),
        }),
      );
    });

    it("counts towards the rate-based rule limit and cannot allow", () => {
      expect(() => withRule((r) => r.rateLimit(100).allow())).toThrow(/cannot Allow/);
    });

    it.each([9, 2_000_000_001, 10.5])("rejects a limit of %d", (limit) => {
      expect(() => withRule((r) => r.rateLimit(limit))).toThrow(/whole number from 10/);
    });

    it("accepts a token limit", () => {
      expect(() => withRule((r) => r.rateLimit(Lazy.number({ produce: () => 5 })))).not.toThrow();
    });

    it("rejects an unsupported window", () => {
      expect(() => withRule((r) => r.rateLimit(100, Duration.minutes(3)))).toThrow(
        /1, 2, 5 or 10 minutes/,
      );
    });

    it("rejects more than five keys", () => {
      expect(() =>
        withRule((r) =>
          r
            .rateLimit(100)
            .aggregateOnHeader("a")
            .aggregateOnHeader("b")
            .aggregateOnHeader("c")
            .aggregateOnHeader("d")
            .aggregateOnHeader("e")
            .aggregateOnHeader("f"),
        ),
      ).toThrow(/at most 5 keys/);
    });

    it("rejects the same header twice, whatever its case", () => {
      expect(() =>
        withRule((r) => r.rateLimit(100).aggregateOnHeader("X-Key").aggregateOnHeader("x-key")),
      ).toThrow(/header "x-key" twice/);
    });

    it("rejects a single-instance key twice", () => {
      expect(() =>
        withRule((r) =>
          r.rateLimit(100).aggregateOn(
            { uriPath: { textTransformations: [] } },
            {
              uriPath: { textTransformations: [] },
            },
          ),
        ),
      ).toThrow(/uriPath twice/);
    });

    it("rejects a key with more than one type", () => {
      expect(() =>
        withRule((r) => r.rateLimit(100).aggregateOn({ ip: {}, httpMethod: {} })),
      ).toThrow(/exactly one key type, but one sets ip, httpMethod/);
    });

    it("rejects a key with no type", () => {
      expect(() => withRule((r) => r.rateLimit(100).aggregateOn({}, { httpMethod: {} }))).toThrow(
        /exactly one key type, but one sets none/,
      );
    });

    it("keeps label namespaces case-sensitive", () => {
      expect(() =>
        withRule((r) =>
          r
            .rateLimit(100)
            .aggregateOn(
              { labelNamespace: { namespace: "a:" } },
              { labelNamespace: { namespace: "A:" } },
            ),
        ),
      ).not.toThrow();
    });

    it("skips the duplicate check for tokens", () => {
      const name = Lazy.string({ produce: () => "x-key" });
      expect(() =>
        withRule((r) =>
          r
            .rateLimit(100)
            .aggregateOn({
              header: Lazy.any({
                produce: () => ({
                  name: "x-other",
                  textTransformations: [{ priority: 0, type: "NONE" }],
                }),
              }),
            })
            .aggregateOnHeader(name)
            .aggregateOnHeader(name),
        ),
      ).not.toThrow();
    });

    it("rejects a second forwarded IP", () => {
      expect(() =>
        withRule((r) =>
          r
            .rateLimit(100)
            .aggregateOnForwardedIp("X-Forwarded-For", "MATCH")
            .aggregateOnForwardedIp("X-Real-IP", "MATCH"),
        ),
      ).toThrow(/already aggregates on a forwarded IP/);
    });

    it("rejects a raw forwarded IP key without its header", () => {
      expect(() =>
        withRule((r) => r.rateLimit(100).aggregateOn({ forwardedIp: {} }, { httpMethod: {} })),
      ).toThrow(/aggregateOnForwardedIp/);
    });

    it("rejects aggregation on a rule that is not rate-based", () => {
      expect(() => withRule((r) => r.statement(ADMIN_PATH).aggregateOnIp())).toThrow(
        /not rate-based/,
      );
    });

    it("rejects a second statement", () => {
      expect(() => withRule((r) => r.statement(ADMIN_PATH).rateLimit(100))).toThrow(
        /rateLimit\(\): the rule already has a statement/,
      );
    });
  });

  describe("blockUnlessHeader", () => {
    it("blocks requests without the header, in CloudFormation's casing", () => {
      const { template } = withRule((r) => r.blockUnlessHeader("x-amz-security-token"));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            Action: { Block: {} },
            Statement: {
              NotStatement: {
                Statement: {
                  SizeConstraintStatement: {
                    FieldToMatch: { SingleHeader: { Name: "x-amz-security-token" } },
                    ComparisonOperator: "GT",
                    Size: 0,
                    TextTransformations: [{ Priority: 0, Type: "NONE" }],
                  },
                },
              },
            },
          }),
        ],
      });
    });

    it("can respond instead of WAF's 403", () => {
      const { template } = withRule((r) =>
        r.blockUnlessHeader("x-api-key").respond(401, { json: { reason: "unauthenticated" } }),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            Action: { Block: { CustomResponse: Match.objectLike({ ResponseCode: 401 }) } },
          }),
        ],
      });
    });

    it("rejects a scope-down", () => {
      expect(() => withRule((r) => r.blockUnlessHeader("x").scopeDown(ADMIN_PATH))).toThrow(
        /applies to rateLimit\(\) and managedRuleGroup\(\) rules only/,
      );
    });
  });

  describe("managedRuleGroup", () => {
    it("evaluates an AWS group with its own actions", () => {
      const { template } = withRule((r) => r.managedRuleGroup("AWSManagedRulesCommonRuleSet"));

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            OverrideAction: { None: {} },
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: "AWS",
                Name: "AWSManagedRulesCommonRuleSet",
              },
            },
          }),
        ],
      });
    });

    it("counts the whole group", () => {
      const { template } = withRule((r) =>
        r.managedRuleGroup("AWSManagedRulesKnownBadInputsRuleSet").count(),
      );

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [Match.objectLike({ OverrideAction: { Count: {} } })],
      });
    });

    it("overrides individual rules, pins a version and scopes down", () => {
      const { template } = withRule((r) =>
        r
          .managedRuleGroup("AWSManagedRulesCommonRuleSet", {
            version: "Version_1.12",
            overrides: { SizeRestrictions_BODY: "count", NoUserAgent_HEADER: "challenge" },
          })
          .scopeDown(ADMIN_PATH),
      );

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          ManagedRuleGroupStatement: Match.objectLike({
            Version: "Version_1.12",
            RuleActionOverrides: [
              { Name: "SizeRestrictions_BODY", ActionToUse: { Count: {} } },
              { Name: "NoUserAgent_HEADER", ActionToUse: { Challenge: {} } },
            ],
            ScopeDownStatement: Match.objectLike({ ByteMatchStatement: Match.anyValue() }),
          }),
        }),
      );
    });

    it("adds a DaysToExpiry alarm for a pinned version", () => {
      const { stack } = buildAndSynth();
      const { alarms } = createWebAclBuilder()
        .addRule("CommonRuleSet", (r) =>
          r.managedRuleGroup("AWSManagedRulesCommonRuleSet", { version: "Version_1.12" }),
        )
        .build(stack, "Pinned");

      expect(alarms.commonRuleSetDaysToExpiry).toBeDefined();
      expect(alarms.commonRuleSetBlockedRequests).toBeUndefined();
    });

    it("passes group configs through and skips unset or token overrides", () => {
      const { template, stack } = withRule((r) =>
        r.managedRuleGroup("AWSManagedRulesCommonRuleSet", {
          overrides: {
            SizeRestrictions_BODY: undefined,
            [Lazy.string({ produce: () => "GenericLFI_BODY" })]: "count",
          },
          managedRuleGroupConfigs: [{ loginPath: "/login" }],
        }),
      );

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          ManagedRuleGroupStatement: Match.objectLike({
            ManagedRuleGroupConfigs: [{ LoginPath: "/login" }],
            RuleActionOverrides: [{ Name: "GenericLFI_BODY", ActionToUse: { Count: {} } }],
          }),
        }),
      );
      Annotations.fromStack(stack).hasNoWarning("*", Match.stringLikeRegexp("silently ignores"));
    });

    it("rejects a version on an IP reputation group", () => {
      expect(() =>
        withRule((r) =>
          r.managedRuleGroup("AWSManagedRulesAmazonIpReputationList", { version: "Version_1.0" }),
        ),
      ).toThrow(/has no versions/);
    });

    it("warns about an override this package does not know", () => {
      const { stack } = withRule((r) =>
        r.managedRuleGroup("AWSManagedRulesCommonRuleSet", {
          overrides: { SizeRestrictions_Body: "count" },
        }),
      );

      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp('overrides "SizeRestrictions_Body".*silently ignores'),
      );
    });

    it("does not warn about a vendor group's rules", () => {
      const { stack } = withRule((r) =>
        r.managedRuleGroup("SomeVendorRules", {
          vendorName: "Vendor",
          overrides: { AnyRule: "count" },
        }),
      );

      Annotations.fromStack(stack).hasNoWarning("*", Match.stringLikeRegexp("silently ignores"));
    });

    it("rejects any action but count", () => {
      expect(() =>
        withRule((r) => r.managedRuleGroup("AWSManagedRulesCommonRuleSet").block()),
      ).toThrow(/evaluates a rule group/);
    });
  });

  describe("ipSet", () => {
    it("references an IP set by ARN", () => {
      const { template } = withRule((r) => r.ipSet(IP_SET_ARN).allow());

      template.hasResourceProperties("AWS::WAFv2::WebACL", {
        Rules: [
          Match.objectLike({
            Action: { Allow: {} },
            Statement: {
              IPSetReferenceStatement: { Arn: IP_SET_ARN },
            },
          }),
        ],
      });
    });

    it("matches a forwarded IP", () => {
      const { template } = withRule((r) =>
        r.ipSet(IP_SET_ARN, {
          headerName: "X-Forwarded-For",
          fallbackBehavior: "NO_MATCH",
          position: "FIRST",
        }),
      );

      template.hasResourceProperties(
        "AWS::WAFv2::WebACL",
        ruleStatement({
          IPSetReferenceStatement: {
            Arn: IP_SET_ARN,
            IPSetForwardedIPConfig: {
              HeaderName: "X-Forwarded-For",
              FallbackBehavior: "NO_MATCH",
              Position: "FIRST",
            },
          },
        }),
      );
    });

    it("resolves a ref to an IP set", () => {
      const { stack } = buildAndSynth();
      const office = new CfnIPSet(stack, "Office", {
        scope: "REGIONAL",
        ipAddressVersion: "IPV4",
        addresses: ["192.0.2.0/24"],
      });
      const { webAcl } = createWebAclBuilder()
        .addRule("Office", (r) => r.ipSet(ref("ips", (s: CfnIPSet) => s.attrArn)).allow())
        .build(stack, "WithIpSet", { ips: office });

      const [rule] = webAcl.rules as CfnWebACL.RuleProperty[];
      const statement = rule.statement as CfnWebACL.StatementProperty;
      expect(stack.resolve(statement.ipSetReferenceStatement)).toEqual({
        arn: { "Fn::GetAtt": [stack.getLogicalId(office), "Arn"] },
      });
    });
  });
});
