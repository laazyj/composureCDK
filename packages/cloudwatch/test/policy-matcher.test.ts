import { describe, it, expect } from "vitest";
import type { CfnAlarm, CfnCompositeAlarm, IAlarm } from "aws-cdk-lib/aws-cloudwatch";
import {
  type AlarmMatchContext,
  type AlarmRuleScope,
  matchesOne,
  ruleMatches,
} from "../src/policies/policy-matcher.js";

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
