import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { CfnAlarm, CfnCompositeAlarm, type IAlarm } from "aws-cdk-lib/aws-cloudwatch";
import { CfnBucket } from "aws-cdk-lib/aws-s3";
import {
  type AlarmMatchContext,
  type AlarmRuleScope,
  isCfnAlarm,
  isCfnCompositeAlarm,
  matchesOne,
  ruleMatches,
} from "../src/policies/policy-matcher.js";
import { withoutIsCfnStatics } from "./_simulate-old-cdk.js";

function makeCfnAlarm(scope: Stack, id: string): CfnAlarm {
  return new CfnAlarm(scope, id, {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 1,
    metricName: "Count",
    namespace: "Test",
    period: 60,
    statistic: "Sum",
    threshold: 1,
  });
}

describe("isCfnAlarm / isCfnCompositeAlarm", () => {
  it("identifies each L1 alarm kind and rejects the other", () => {
    const stack = new Stack(new App(), "TestStack");
    const alarm = makeCfnAlarm(stack, "Alarm");
    const composite = new CfnCompositeAlarm(stack, "Composite", {
      alarmName: "TestComposite",
      alarmRule: "ALARM(x)",
    });

    expect(isCfnAlarm(alarm)).toBe(true);
    expect(isCfnCompositeAlarm(alarm)).toBe(false);
    expect(isCfnCompositeAlarm(composite)).toBe(true);
    expect(isCfnAlarm(composite)).toBe(false);
  });

  it("rejects non-alarm resources", () => {
    const stack = new Stack(new App(), "TestStack");
    const bucket = new CfnBucket(stack, "Bucket");

    expect(isCfnAlarm(bucket)).toBe(false);
    expect(isCfnCompositeAlarm(bucket)).toBe(false);
  });

  it("works on aws-cdk-lib < 2.231.0 (no isCfn* statics)", () => {
    const stack = new Stack(new App(), "TestStack");
    const alarm = makeCfnAlarm(stack, "Alarm");
    const composite = new CfnCompositeAlarm(stack, "Composite", {
      alarmName: "TestComposite",
      alarmRule: "ALARM(x)",
    });

    withoutIsCfnStatics(() => {
      expect(isCfnAlarm(alarm)).toBe(true);
      expect(isCfnCompositeAlarm(composite)).toBe(true);
    });
  });
});

function ctx(overrides: Partial<AlarmMatchContext> = {}): AlarmMatchContext {
  return {
    alarm: undefined as IAlarm | undefined,
    cfn: {} as CfnAlarm | CfnCompositeAlarm,
    id: "Errors",
    path: "App/Stack/Service/Errors",
    isComposite: false,
    ...overrides,
  };
}

describe("matchesOne", () => {
  describe("string matcher", () => {
    it("matches a substring of id", () => {
      expect(matchesOne("Error", ctx({ id: "Errors", path: "unrelated" }))).toBe(true);
    });

    it("matches a substring of path", () => {
      expect(matchesOne("Service", ctx({ id: "unrelated", path: "App/Service/Errors" }))).toBe(
        true,
      );
    });

    it("returns false when the substring appears in neither id nor path", () => {
      expect(matchesOne("Throttles", ctx({ id: "Errors", path: "App/Stack/Errors" }))).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(matchesOne("errors", ctx({ id: "Errors", path: "App/Errors" }))).toBe(false);
    });
  });

  describe("regex matcher", () => {
    it("matches against path only, not id", () => {
      expect(matchesOne(/Errors$/, ctx({ id: "Errors", path: "App/Service/foo" }))).toBe(false);
      expect(matchesOne(/Errors$/, ctx({ id: "foo", path: "App/Service/Errors" }))).toBe(true);
    });

    it("supports flags", () => {
      expect(matchesOne(/errors/i, ctx({ path: "App/Service/Errors" }))).toBe(true);
    });
  });

  describe("predicate matcher", () => {
    it("receives the full context and returns its result", () => {
      const seen: AlarmMatchContext[] = [];
      const result = matchesOne(
        (c) => {
          seen.push(c);
          return c.isComposite;
        },
        ctx({ isComposite: true }),
      );
      expect(result).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.isComposite).toBe(true);
    });

    it("returns false when predicate returns false", () => {
      expect(matchesOne(() => false, ctx())).toBe(false);
    });
  });
});

describe("ruleMatches", () => {
  it("returns true when a single matcher matches", () => {
    const rule: AlarmRuleScope = { match: "Errors" };
    expect(ruleMatches(rule, ctx({ id: "Errors" }))).toBe(true);
  });

  it("returns true when any matcher in an array matches (OR semantics)", () => {
    const rule: AlarmRuleScope = { match: ["Throttles", /Errors$/] };
    expect(ruleMatches(rule, ctx({ id: "foo", path: "App/Service/Errors" }))).toBe(true);
  });

  it("returns false when no matcher in an array matches", () => {
    const rule: AlarmRuleScope = { match: ["Throttles", /Latency$/] };
    expect(ruleMatches(rule, ctx({ id: "Errors", path: "App/Service/Errors" }))).toBe(false);
  });

  describe("singleOnly", () => {
    it("excludes composite alarms when set", () => {
      const rule: AlarmRuleScope = { match: "Errors", singleOnly: true };
      expect(ruleMatches(rule, ctx({ id: "Errors", isComposite: true }))).toBe(false);
      expect(ruleMatches(rule, ctx({ id: "Errors", isComposite: false }))).toBe(true);
    });

    it("has no effect when false or omitted", () => {
      expect(ruleMatches({ match: "Errors", singleOnly: false }, ctx({ isComposite: true }))).toBe(
        true,
      );
      expect(ruleMatches({ match: "Errors" }, ctx({ isComposite: true }))).toBe(true);
    });
  });

  describe("compositeOnly", () => {
    it("excludes single alarms when set", () => {
      const rule: AlarmRuleScope = { match: "Errors", compositeOnly: true };
      expect(ruleMatches(rule, ctx({ id: "Errors", isComposite: false }))).toBe(false);
      expect(ruleMatches(rule, ctx({ id: "Errors", isComposite: true }))).toBe(true);
    });

    it("has no effect when false or omitted", () => {
      expect(
        ruleMatches({ match: "Errors", compositeOnly: false }, ctx({ isComposite: false })),
      ).toBe(true);
      expect(ruleMatches({ match: "Errors" }, ctx({ isComposite: false }))).toBe(true);
    });
  });

  it("scope filters short-circuit before matchers run", () => {
    let called = false;
    const rule: AlarmRuleScope = {
      match: () => {
        called = true;
        return true;
      },
      singleOnly: true,
    };
    ruleMatches(rule, ctx({ isComposite: true }));
    expect(called).toBe(false);
  });
});
