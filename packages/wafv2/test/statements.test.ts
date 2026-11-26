import { describe, expect, it } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { Lazy } from "aws-cdk-lib";
import { type CfnWebACL, CfnRegexPatternSet } from "aws-cdk-lib/aws-wafv2";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { ref, type Resolvable } from "@composurecdk/core";
import { createWebAclBuilder } from "../src/web-acl-builder.js";
import { fieldToMatch, ruleStatements } from "../src/statements.js";

const buildAndSynth = buildFixture(createWebAclBuilder, "Waf");

const REGEX_SET_ARN = "arn:aws:wafv2:us-east-1:123456789012:regional/regexpatternset/bots/abc";

/** Synthesises a web ACL with one rule per statement, and returns the rules' synthesised statements. */
const synthStatements = (...statements: Resolvable<CfnWebACL.StatementProperty>[]) => {
  const { template } = buildAndSynth((b) =>
    statements.reduce(
      (acl, statement, i) => acl.addRule(`Rule${String(i)}`, (r) => r.statement(statement)),
      b,
    ),
  );
  const [acl] = Object.values(template.findResources("AWS::WAFv2::WebACL")) as {
    Properties: { Rules: { Statement: unknown }[] };
  }[];
  return acl.Properties.Rules.map((rule) => rule.Statement);
};

const synthStatement = (statement: Resolvable<CfnWebACL.StatementProperty>) =>
  synthStatements(statement)[0];

describe("fieldToMatch", () => {
  // CDK types these fields as `any`, so the PascalCase must survive synth as written.
  it("emits CloudFormation's casing", () => {
    const fields = [
      [fieldToMatch.header("User-Agent"), { SingleHeader: { Name: "User-Agent" } }],
      [fieldToMatch.queryArgument("id"), { SingleQueryArgument: { Name: "id" } }],
      [fieldToMatch.allQueryArguments(), { AllQueryArguments: {} }],
      [fieldToMatch.queryString(), { QueryString: {} }],
      [fieldToMatch.uriPath(), { UriPath: {} }],
      [fieldToMatch.method(), { Method: {} }],
      [fieldToMatch.body(), { Body: {} }],
      [fieldToMatch.body("MATCH"), { Body: { OversizeHandling: "MATCH" } }],
    ] as const;

    const synthesised = synthStatements(
      ...fields.map(([field]) => ruleStatements.sizeConstraint(field, "GT", 0)),
    ) as { SizeConstraintStatement: { FieldToMatch: unknown } }[];
    expect(synthesised.map((st) => st.SizeConstraintStatement.FieldToMatch)).toEqual(
      fields.map(([, expected]) => expected),
    );
  });

  it("rejects a query argument name over 30 characters", () => {
    expect(() => fieldToMatch.queryArgument("a".repeat(31))).toThrow(/30-character limit/);
    expect(() => fieldToMatch.queryArgument("")).toThrow(/1-character minimum/);
  });
});

describe("ruleStatements", () => {
  describe("geoMatch", () => {
    it("matches countries", () => {
      expect(synthStatement(ruleStatements.geoMatch(["KP", "IR"]))).toEqual({
        GeoMatchStatement: { CountryCodes: ["KP", "IR"] },
      });
    });

    it("locates the client by a forwarded IP", () => {
      expect(
        synthStatement(
          ruleStatements.geoMatch(["GB"], {
            headerName: "X-Forwarded-For",
            fallbackBehavior: "NO_MATCH",
          }),
        ),
      ).toEqual({
        GeoMatchStatement: {
          CountryCodes: ["GB"],
          ForwardedIPConfig: { HeaderName: "X-Forwarded-For", FallbackBehavior: "NO_MATCH" },
        },
      });
    });

    it("accepts Kosovo", () => {
      expect(() => ruleStatements.geoMatch(["XK"])).not.toThrow();
    });

    it("rejects codes WAF does not accept, naming them", () => {
      expect(() => ruleStatements.geoMatch(["UK", "us", "USA", "FR"])).toThrow(
        /such as "GB", but not "UK", "us", "USA"\./,
      );
    });

    it("rejects no codes, or more than 50", () => {
      expect(() => ruleStatements.geoMatch([])).toThrow(/1 to 50 country codes, but 0/);
      expect(() => ruleStatements.geoMatch(Array<string>(51).fill("GB"))).toThrow(/but 51/);
    });

    it("skips tokens", () => {
      expect(() => ruleStatements.geoMatch([Lazy.string({ produce: () => "GB" })])).not.toThrow();
    });
  });

  describe("byteMatch", () => {
    it("matches a string, with no transformation by default", () => {
      expect(
        synthStatement(ruleStatements.byteMatch(fieldToMatch.uriPath(), "STARTS_WITH", "/admin")),
      ).toEqual({
        ByteMatchStatement: {
          FieldToMatch: { UriPath: {} },
          PositionalConstraint: "STARTS_WITH",
          SearchString: "/admin",
          TextTransformations: [{ Priority: 0, Type: "NONE" }],
        },
      });
    });

    it("applies transformations in order", () => {
      const statement = ruleStatements.byteMatch(
        fieldToMatch.header("user-agent"),
        "CONTAINS",
        "curl",
        ["URL_DECODE", "LOWERCASE"],
      );
      expect(statement.byteMatchStatement).toMatchObject({
        textTransformations: [
          { priority: 0, type: "URL_DECODE" },
          { priority: 1, type: "LOWERCASE" },
        ],
      });
    });

    it("rejects an empty search string, or one over 200 bytes", () => {
      const field = fieldToMatch.uriPath();
      expect(() => ruleStatements.byteMatch(field, "EXACTLY", "")).toThrow(/1 to 200 bytes/);
      expect(() => ruleStatements.byteMatch(field, "EXACTLY", "é".repeat(101))).toThrow(
        /but was 202/,
      );
    });

    it("skips a token search string", () => {
      const token = Lazy.string({ produce: () => "" });
      expect(() =>
        ruleStatements.byteMatch(fieldToMatch.uriPath(), "EXACTLY", token),
      ).not.toThrow();
    });

    it("rejects no transformations, or more than 10", () => {
      const field = fieldToMatch.uriPath();
      expect(() => ruleStatements.byteMatch(field, "EXACTLY", "/", [])).toThrow(
        /1 to 10 text transformations, but 0/,
      );
      expect(() =>
        ruleStatements.byteMatch(field, "EXACTLY", "/", Array(11).fill("LOWERCASE")),
      ).toThrow(/but 11/);
    });
  });

  describe("sizeConstraint", () => {
    it("guards against oversize bodies", () => {
      expect(
        synthStatement(ruleStatements.sizeConstraint(fieldToMatch.body("MATCH"), "GT", 8192)),
      ).toEqual({
        SizeConstraintStatement: {
          FieldToMatch: { Body: { OversizeHandling: "MATCH" } },
          ComparisonOperator: "GT",
          Size: 8192,
          TextTransformations: [{ Priority: 0, Type: "NONE" }],
        },
      });
    });

    it.each([-1, 1.5, 21_474_836_481])("rejects a size of %d", (size) => {
      expect(() => ruleStatements.sizeConstraint(fieldToMatch.body(), "GT", size)).toThrow(
        /whole number from 0 to 21,474,836,480/,
      );
    });

    it("skips a token size", () => {
      expect(() =>
        ruleStatements.sizeConstraint(
          fieldToMatch.body(),
          "GT",
          Lazy.number({ produce: () => -1 }),
        ),
      ).not.toThrow();
    });
  });

  describe("regexPatternSet", () => {
    it("references a regex pattern set by ARN", () => {
      expect(
        synthStatement(
          ruleStatements.regexPatternSet(REGEX_SET_ARN, fieldToMatch.header("user-agent"), [
            "LOWERCASE",
          ]),
        ),
      ).toEqual({
        RegexPatternSetReferenceStatement: {
          Arn: REGEX_SET_ARN,
          FieldToMatch: { SingleHeader: { Name: "user-agent" } },
          TextTransformations: [{ Priority: 0, Type: "LOWERCASE" }],
        },
      });
    });

    it("resolves a ref to a regex pattern set", () => {
      const stack = newStack();
      const patterns = new CfnRegexPatternSet(stack, "Bots", {
        scope: "REGIONAL",
        regularExpressionList: ["^curl/"],
      });
      const { webAcl } = createWebAclBuilder()
        .addRule("Bots", (r) =>
          r.statement(
            ruleStatements.regexPatternSet(
              ref("patterns", (p: CfnRegexPatternSet) => p.attrArn),
              fieldToMatch.header("user-agent"),
            ),
          ),
        )
        .build(stack, "WithPatterns", { patterns });

      const [rule] = webAcl.rules as CfnWebACL.RuleProperty[];
      const statement = rule.statement as CfnWebACL.StatementProperty;
      expect(stack.resolve(statement.regexPatternSetReferenceStatement)).toMatchObject({
        arn: { "Fn::GetAtt": [stack.getLogicalId(patterns), "Arn"] },
      });
    });

    it("rejects an ARN shorter than WAF allows", () => {
      expect(() => ruleStatements.regexPatternSet("arn:short", fieldToMatch.uriPath())).toThrow(
        /ARN "arn:short" is shorter than the 20-character minimum/,
      );
    });
  });

  it("scopes down a rule", () => {
    const { template } = buildAndSynth((b) =>
      b.addRule("AdminRate", (r) =>
        r
          .rateLimit(100)
          .scopeDown(ruleStatements.byteMatch(fieldToMatch.uriPath(), "STARTS_WITH", "/admin")),
      ),
    );

    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: [
        Match.objectLike({
          Statement: {
            RateBasedStatement: Match.objectLike({
              ScopeDownStatement: {
                ByteMatchStatement: Match.objectLike({ FieldToMatch: { UriPath: {} } }),
              },
            }),
          },
        }),
      ],
    });
  });
});
