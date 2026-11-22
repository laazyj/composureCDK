import { describe, expect, it } from "vitest";
import { Lazy } from "aws-cdk-lib";
import { constraints } from "../src/index.js";

const token = Lazy.string({ produce: () => "resolved" });

describe("constraints", () => {
  describe.each([
    ["webAclName", constraints.validate.webAclName],
    ["ruleName", constraints.validate.ruleName],
    ["metricName", constraints.validate.metricName],
  ])("%s", (_, validate) => {
    it.each(["api-waf", "Api_Waf_1", "a".repeat(128)])("accepts %s", (value) => {
      expect(() => {
        validate(value);
      }).not.toThrow();
    });

    it.each(["", "has space", "dots.not.allowed", "a".repeat(129)])("rejects %s", (value) => {
      expect(() => {
        validate(value);
      }).toThrow();
    });

    it("skips a token", () => {
      expect(() => {
        validate(token);
      }).not.toThrow();
    });
  });

  describe("webAclDescription", () => {
    it.each([
      "Protects the API",
      "Rate limits: 60/min per client, 3000/5m per IP.",
      "abc",
      "a".repeat(256),
    ])("accepts %s", (value) => {
      expect(() => {
        constraints.validate.webAclDescription(value);
      }).not.toThrow();
    });

    it.each([
      ["an apostrophe", "The API's web ACL"],
      ["an underscore", "api_waf"],
      ["an em-dash", "API \u2014 edge"],
      ["a leading +", "+ protects"],
      ["a leading space", " Protects"],
      ["a trailing space", "Protects "],
      ["fewer than three characters", "ab"],
      ["more than 256 characters", "a".repeat(257)],
    ])("rejects %s", (_, value) => {
      expect(() => {
        constraints.validate.webAclDescription(value);
      }).toThrow(/WAFv2 WebACL Description/);
    });

    it("skips a token", () => {
      expect(() => {
        constraints.validate.webAclDescription(token);
      }).not.toThrow();
    });
  });

  describe("metricName", () => {
    it.each(["All", "Default_Action"])("rejects the reserved %s", (value) => {
      expect(() => {
        constraints.validate.metricName(value);
      }).toThrow(/reserved by AWS WAF/);
    });
  });

  describe("ruleLabel", () => {
    it.each(["throttled", "auth:missing-token", "a:b:c:d:e:name", "x".repeat(128)])(
      "accepts %s",
      (value) => {
        expect(() => {
          constraints.validate.ruleLabel(value);
        }).not.toThrow();
      },
    );

    it.each([
      ["", /rule label part/],
      ["a::b", /rule label part/],
      ["x".repeat(129), /rule label part/],
      ["a:b:c:d:e:f:name", /6 namespaces/],
      ["webacl:thing", /reserves/],
      ["thing:managed", /reserves/],
    ])("rejects %s", (value, error) => {
      expect(() => {
        constraints.validate.ruleLabel(value);
      }).toThrow(error);
    });

    it("skips a token", () => {
      expect(() => {
        constraints.validate.ruleLabel(token);
      }).not.toThrow();
    });
  });
});
