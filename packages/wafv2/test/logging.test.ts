import { describe, expect, it } from "vitest";
import { Lazy, RemovalPolicy } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { buildFixture } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createWebAclBuilder } from "../src/web-acl-builder.js";

const buildAndSynth = buildFixture(createWebAclBuilder, "Waf");

const NON_ALLOW_FILTER = {
  DefaultBehavior: "DROP",
  Filters: [
    {
      Behavior: "KEEP",
      Requirement: "MEETS_ANY",
      Conditions: [
        { ActionCondition: { Action: "BLOCK" } },
        { ActionCondition: { Action: "COUNT" } },
        { ActionCondition: { Action: "CAPTCHA" } },
        { ActionCondition: { Action: "CHALLENGE" } },
        { ActionCondition: { Action: "EXCLUDED_AS_COUNT" } },
      ],
    },
  ],
};

const DEFAULT_REDACTION = [
  { SingleHeader: { Name: "authorization" } },
  { SingleHeader: { Name: "cookie" } },
];

describe("WebAclBuilder logging", () => {
  describe("defaults", () => {
    it("creates an aws-waf-logs- log group with the logs defaults", () => {
      const { template, result } = buildAndSynth((b) => b.name("api-waf"));

      expect(result.logGroup).toBeDefined();
      template.hasResource("AWS::Logs::LogGroup", {
        Properties: { LogGroupName: "aws-waf-logs-api-waf", RetentionInDays: 731 },
        DeletionPolicy: "Retain",
      });
    });

    it("derives the log group name from the construct path when the web ACL is unnamed", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp("^aws-waf-logs-[A-Za-z0-9]+$"),
      });
    });

    it("logs to the log group's ARN without the trailing :*", () => {
      const { template } = buildAndSynth((b) => b.name("api-waf"));

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        ResourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Waf"), "Arn"] },
        LogDestinationConfigs: [
          {
            "Fn::Join": [
              "",
              [
                "arn:",
                { Ref: "AWS::Partition" },
                ":logs:",
                { Ref: "AWS::Region" },
                ":",
                { Ref: "AWS::AccountId" },
                ":log-group:",
                { Ref: Match.stringLikeRegexp("^WafLogs") },
              ],
            ],
          },
        ],
      });
    });

    it("depends on the log group", () => {
      const { template } = buildAndSynth();

      template.hasResource("AWS::WAFv2::LoggingConfiguration", {
        DependsOn: [Match.stringLikeRegexp("^WafLogs")],
      });
    });

    it("keeps only requests WAF does not allow, in CloudFormation casing", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        LoggingFilter: NON_ALLOW_FILTER,
      });
    });

    it("redacts the authorization and cookie headers", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        RedactedFields: DEFAULT_REDACTION,
      });
    });

    it("returns the logging configuration", () => {
      const { result } = buildAndSynth();

      expect(result.logging).toBeDefined();
    });
  });

  it("can be turned off", () => {
    const { template, result } = buildAndSynth((b) => b.logging(false));

    expect(result.logGroup).toBeUndefined();
    expect(result.logging).toBeUndefined();
    template.resourceCountIs("AWS::WAFv2::LoggingConfiguration", 0);
    template.resourceCountIs("AWS::Logs::LogGroup", 0);
  });

  describe("filter", () => {
    it("logs everything with 'all'", () => {
      const { template } = buildAndSynth((b) => b.logging({ filter: "all" }));

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        LoggingFilter: Match.absent(),
      });
    });

    it("accepts 'non-allow' explicitly", () => {
      const { template } = buildAndSynth((b) => b.logging({ filter: "non-allow" }));

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        LoggingFilter: NON_ALLOW_FILTER,
      });
    });

    it("emits a typed filter in CloudFormation casing", () => {
      const { template } = buildAndSynth((b) =>
        b.logging({
          filter: {
            defaultBehavior: "KEEP",
            filters: [
              {
                behavior: "DROP",
                requirement: "MEETS_ALL",
                conditions: [{ action: "ALLOW" }, { label: "awswaf:managed:token:accepted" }],
              },
            ],
          },
        }),
      );

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        LoggingFilter: {
          DefaultBehavior: "KEEP",
          Filters: [
            {
              Behavior: "DROP",
              Requirement: "MEETS_ALL",
              Conditions: [
                { ActionCondition: { Action: "ALLOW" } },
                { LabelNameCondition: { LabelName: "awswaf:managed:token:accepted" } },
              ],
            },
          ],
        },
      });
    });
  });

  describe("redact", () => {
    it("adds headers and fields to the defaults", () => {
      const { template } = buildAndSynth((b) =>
        b.logging({
          redact: {
            headers: ["x-amz-security-token", "Authorization"],
            queryString: true,
            uriPath: true,
            method: true,
          },
        }),
      );

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        RedactedFields: [
          { SingleHeader: { Name: "Authorization" } },
          { SingleHeader: { Name: "cookie" } },
          { SingleHeader: { Name: "x-amz-security-token" } },
          { QueryString: {} },
          { UriPath: {} },
          { Method: {} },
        ],
      });
    });

    it("rejects more than 100 fields", () => {
      const headers = Array.from({ length: 99 }, (_, i) => `x-h${String(i)}`);

      expect(() => buildAndSynth((b) => b.logging({ redact: { headers } }))).toThrow(
        /redacts 101 fields; AWS WAF allows at most 100/,
      );
    });
  });

  describe("configure", () => {
    it("customizes the log group", () => {
      const { template } = buildAndSynth((b) =>
        b.logging({
          configure: (lg) =>
            lg.retention(RetentionDays.ONE_MONTH).removalPolicy(RemovalPolicy.DESTROY),
        }),
      );

      template.hasResource("AWS::Logs::LogGroup", {
        Properties: Match.objectLike({ RetentionInDays: 30 }),
        DeletionPolicy: "Delete",
      });
    });

    it("accepts a name inside the prefix", () => {
      const { template } = buildAndSynth((b) =>
        b.logging({ configure: (lg) => lg.logGroupName("aws-waf-logs-custom") }),
      );

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "aws-waf-logs-custom",
      });
    });

    it("skips the prefix check for a token name", () => {
      const name = Lazy.string({ produce: () => "aws-waf-logs-late" });

      expect(() =>
        buildAndSynth((b) => b.logging({ configure: (lg) => lg.logGroupName(name) })),
      ).not.toThrow();
    });

    it("rejects a name outside the prefix", () => {
      expect(() =>
        buildAndSynth((b) => b.logging({ configure: (lg) => lg.logGroupName("/waf/api") })),
      ).toThrow(
        /named "\/waf\/api", but AWS WAF only logs to log groups whose names start with "aws-waf-logs-"/,
      );
    });
  });

  describe("destination", () => {
    const BUCKET = "arn:aws:s3:::aws-waf-logs-central";

    it("logs to it, creating no log group", () => {
      const { template, result } = buildAndSynth((b) => b.logging({ destination: BUCKET }));

      expect(result.logGroup).toBeUndefined();
      template.resourceCountIs("AWS::Logs::LogGroup", 0);
      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        LogDestinationConfigs: [BUCKET],
        LoggingFilter: NON_ALLOW_FILTER,
        RedactedFields: DEFAULT_REDACTION,
      });
    });

    it("resolves a ref", () => {
      const { template } = buildAndSynth(
        (b) => b.logging({ destination: ref("central", (r: { arn: string }) => r.arn) }),
        { context: { central: { arn: BUCKET } } },
      );

      template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
        LogDestinationConfigs: [BUCKET],
      });
    });

    it("cannot be combined with configure", () => {
      expect(() =>
        buildAndSynth((b) => b.logging({ destination: BUCKET, configure: (lg) => lg })),
      ).toThrow(/'configure' cannot be combined with 'destination'/);
    });
  });
});
