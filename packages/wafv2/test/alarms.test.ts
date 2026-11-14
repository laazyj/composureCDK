import { describe, expect, it } from "vitest";
import { Lazy } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { buildFixture } from "@composurecdk/cdk-testing";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { ruleAlarmKey } from "../src/alarms.js";
import type { IWebAclRuleBuilder } from "../src/rule-builder.js";
import { createWebAclBuilder } from "../src/web-acl-builder.js";

const buildAndSynth = buildFixture(createWebAclBuilder, "Waf");

const PATH: CfnWebACL.StatementProperty = {
  byteMatchStatement: {
    fieldToMatch: { uriPath: {} },
    positionalConstraint: "STARTS_WITH",
    searchString: "/admin",
    textTransformations: [{ priority: 0, type: "NONE" }],
  },
};

const managed = (version?: string): CfnWebACL.StatementProperty => ({
  managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet", version },
});

const pathRule = (rule: IWebAclRuleBuilder) => rule.statement(PATH);

describe("WebAclBuilder metrics", () => {
  it("builds regional dimensions from the web ACL's name and Rule=ALL", () => {
    const { result, stack } = buildAndSynth((b) => b.name("api-waf"));

    expect(stack.resolve(result.metrics.blockedRequests().dimensions)).toEqual({
      WebACL: "api-waf",
      Rule: "ALL",
      Region: { Ref: "AWS::Region" },
    });
  });

  it("reads an unnamed web ACL's name from its Ref", () => {
    const { result, stack } = buildAndSynth();

    const dimensions = JSON.stringify(stack.resolve(result.metrics.allowedRequests().dimensions));
    expect(dimensions).toMatch(/"WebACL":\{"Fn::Select":\[0,\{"Fn::Split":\["\|",\{"Ref":"Waf/);
  });

  it("uses the rule's metric name for the Rule dimension", () => {
    const { result } = buildAndSynth((b) =>
      b.name("api-waf").addRule("Admin", (r) => pathRule(r).metricName("AdminMetric")),
    );

    expect(result.metrics.rule("Admin").countedRequests().dimensions).toMatchObject({
      Rule: "AdminMetric",
    });
  });

  it("reports the default action under the web ACL's metric name", () => {
    const { result } = buildAndSynth((b) => b.name("api-waf").metricName("ApiWaf"));

    expect(result.metrics.defaultAction.allowedRequests().dimensions).toMatchObject({
      WebACL: "api-waf",
      Rule: "ApiWaf",
    });
  });

  it("is a 5-minute Sum by default, overridable", () => {
    const { result } = buildAndSynth();

    const metric = result.metrics.captchaRequests();
    expect(metric.statistic).toBe("Sum");
    expect(metric.period.toMinutes()).toBe(5);
    expect(result.metrics.challengeRequests({ statistic: "Maximum" }).statistic).toBe("Maximum");
  });

  it("omits Region for CloudFront", () => {
    const { result } = buildAndSynth((b) => b.scope("CLOUDFRONT").name("edge"), {
      stackProps: { env: { region: "us-east-1" } },
    });

    expect(result.metrics.blockedRequests().dimensions).toEqual({ WebACL: "edge", Rule: "ALL" });
  });

  it("names a pinned group's DaysToExpiry dimensions", () => {
    const { result } = buildAndSynth((b) => b.scope("REGIONAL"), {
      stackProps: { env: { region: "eu-west-2" } },
    });

    const metric = result.metrics.daysToExpiry({
      vendorName: "AWS",
      name: "AWSManagedRulesCommonRuleSet",
      version: "Version_1.12",
    });
    expect(metric.dimensions).toEqual({
      Vendor: "AWS",
      ManagedRuleGroup: "AWSManagedRulesCommonRuleSet",
      Version: "Version_1.12",
      Region: "eu-west-2",
    });
    expect(metric.statistic).toBe("Minimum");
  });

  it("throws for an unknown rule, listing the rules", () => {
    const { result } = buildAndSynth((b) => b.addRule("Admin", pathRule));

    expect(() => result.metrics.rule("Nope")).toThrow(/no rule named "Nope". Rules: Admin/);
  });

  it("says so when there are no rules", () => {
    const { result } = buildAndSynth();

    expect(() => result.metrics.rule("Nope")).toThrow(/Rules: none/);
  });
});

describe("WebAclBuilder recommended alarms", () => {
  it("alarms on any block by a rule you wrote", () => {
    const { result, template } = buildAndSynth((b) =>
      b.name("api-waf").addRule("PerIpRate", pathRule),
    );

    expect(Object.keys(result.alarms)).toEqual(["perIpRateBlockedRequests"]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/WAFV2",
      MetricName: "BlockedRequests",
      Dimensions: Match.arrayWith([{ Name: "Rule", Value: "PerIpRate" }]),
      Statistic: "Sum",
      Period: 300,
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      TreatMissingData: "notBreaching",
    });
  });

  it.each(["count", "allow", "captcha", "challenge"] as const)(
    "creates no blocked alarm for a %s rule",
    (action) => {
      const { result } = buildAndSynth((b) => b.addRule("Rule", (r) => pathRule(r)[action]()));

      expect(result.alarms).toEqual({});
    },
  );

  it("tunes a rule's alarm", () => {
    const { template } = buildAndSynth((b) =>
      b.addRule("Rule", (r) => pathRule(r).alarms({ blockedRequests: { threshold: 100 } })),
    );

    template.hasResourceProperties("AWS::CloudWatch::Alarm", { Threshold: 100 });
  });

  it.each([
    ["false", false],
    ["enabled: false", { enabled: false }],
    ["blockedRequests: false", { blockedRequests: false }],
  ] as const)("disables a rule's alarms with %s", (_, config) => {
    const { result } = buildAndSynth((b) => b.addRule("Rule", (r) => pathRule(r).alarms(config)));

    expect(result.alarms).toEqual({});
  });

  it.each([
    ["false", false],
    ["enabled: false", { enabled: false }],
  ] as const)("disables every recommended alarm with %s", (_, config) => {
    const { result } = buildAndSynth((b) => b.addRule("Rule", pathRule).recommendedAlarms(config));

    expect(result.alarms).toEqual({});
  });

  it("camel-cases the rule name into the key", () => {
    expect(ruleAlarmKey("PerIpRate")).toBe("perIpRate");
    expect(ruleAlarmKey("per-ip_rate")).toBe("perIpRate");
    expect(ruleAlarmKey("_x")).toBe("x");
  });

  it("throws, naming both rules, when two rules share an alarm key", () => {
    expect(() =>
      buildAndSynth((b) => b.addRule("PerIp", pathRule).addRule("per-ip", pathRule)),
    ).toThrow(/rules "PerIp" and "per-ip" both have alarm key "perIp"/);
  });

  it("allows rules that share a key when only one of them has alarms", () => {
    const { result } = buildAndSynth((b) =>
      b.addRule("PerIp", pathRule).addRule("per-ip", (r) => pathRule(r).alarms(false)),
    );

    expect(Object.keys(result.alarms)).toEqual(["perIpBlockedRequests"]);
  });

  describe("rule groups", () => {
    it("creates no blocked alarm by default", () => {
      const { result } = buildAndSynth((b) => b.addRule("Common", (r) => r.statement(managed())));

      expect(result.alarms).toEqual({});
    });

    it("creates one on request", () => {
      const { result } = buildAndSynth((b) =>
        b.addRule("Common", (r) => r.statement(managed()).alarms({ blockedRequests: {} })),
      );

      expect(Object.keys(result.alarms)).toEqual(["commonBlockedRequests"]);
    });

    it("creates none for a counted group, even on request", () => {
      const { result } = buildAndSynth((b) =>
        b.addRule("Common", (r) => r.statement(managed()).count().alarms({ blockedRequests: {} })),
      );

      expect(result.alarms).toEqual({});
    });

    it("alarms before a pinned version expires", () => {
      const { result, template } = buildAndSynth((b) =>
        b.addRule("Common", (r) => r.statement(managed("Version_1.12"))),
      );

      expect(Object.keys(result.alarms)).toEqual(["commonDaysToExpiry"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "DaysToExpiry",
        Dimensions: Match.arrayWith([{ Name: "Version", Value: "Version_1.12" }]),
        Statistic: "Minimum",
        Period: 3600,
        Threshold: 30,
        ComparisonOperator: "LessThanThreshold",
        AlarmDescription: Match.stringLikeRegexp("version Version_1.12"),
      });
    });

    it("describes a token version generically", () => {
      const version = Lazy.string({ produce: () => "Version_1.12" });
      const { template } = buildAndSynth((b) =>
        b.addRule("Common", (r) => r.statement(managed(version))),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmDescription: Match.stringLikeRegexp("at its pinned version"),
      });
    });

    it("can turn off the expiry alarm", () => {
      const { result } = buildAndSynth((b) =>
        b.addRule("Common", (r) =>
          r.statement(managed("Version_1.12")).alarms({ daysToExpiry: false }),
        ),
      );

      expect(result.alarms).toEqual({});
    });

    it("ignores a token managed-group statement", () => {
      const statement = Lazy.any({ produce: () => ({ vendorName: "AWS", name: "X" }) });
      const { result } = buildAndSynth((b) =>
        b.addRule("Common", (r) => r.statement({ managedRuleGroupStatement: statement }).count()),
      );

      expect(result.alarms).toEqual({});
    });
  });
});

describe("WebAclBuilder custom alarms", () => {
  it("adds an alarm on a rule's metric", () => {
    const { result, template } = buildAndSynth((b) =>
      b
        .addRule("Probe", (r) => pathRule(r).count())
        .addAlarm("probeCounted", (a) =>
          a.metric((m) => m.rule("Probe").countedRequests()).threshold(10),
        ),
    );

    expect(Object.keys(result.alarms)).toEqual(["probeCounted"]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "CountedRequests",
      Threshold: 10,
    });
  });

  it("adds several with addAlarms", () => {
    const { result } = buildAndSynth((b) =>
      b.addAlarms({
        allBlocked: (a) => a.metric((m) => m.blockedRequests()).threshold(1000),
        defaultAllowed: (a) => a.metric((m) => m.defaultAction.allowedRequests()).threshold(1),
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["allBlocked", "defaultAllowed"]);
  });

  it("copies custom alarms", () => {
    assertCopyPreservesState({
      factory: createWebAclBuilder,
      configure: (b) => {
        b.addAlarm("first", (a) => a.metric((m) => m.blockedRequests()));
      },
      mutate: (b) => {
        b.addAlarm("second", (a) => a.metric((m) => m.blockedRequests()));
      },
      build: (b) => buildFixture(() => b, "Waf")().result,
      inspect: (result) => Object.keys(result.alarms),
    });
  });
});
