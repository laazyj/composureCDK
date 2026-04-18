import { describe, expect, it } from "vitest";
import { Effect } from "aws-cdk-lib/aws-iam";
import { createStatementBuilder, WildcardResourceError } from "../src/statement-builder.js";

describe("StatementBuilder", () => {
  describe("build", () => {
    it("produces a PolicyStatement with the configured values", () => {
      const stmt = createStatementBuilder()
        .sid("AllowS3Read")
        .allow()
        .actions(["s3:GetObject"])
        .resources(["arn:aws:s3:::my-bucket/*"])
        .build();

      const rendered = stmt.toJSON() as {
        Sid: string;
        Effect: string;
        Action: string | string[];
        Resource: string | string[];
      };
      expect(rendered.Sid).toBe("AllowS3Read");
      expect(rendered.Effect).toBe("Allow");
      expect(rendered.Action).toBe("s3:GetObject");
      expect(rendered.Resource).toBe("arn:aws:s3:::my-bucket/*");
    });

    it("defaults Effect to Allow", () => {
      const stmt = createStatementBuilder()
        .actions(["s3:GetObject"])
        .resources(["arn:aws:s3:::bucket/key"])
        .build();

      expect(stmt.effect).toBe(Effect.ALLOW);
    });

    it("supports Deny statements", () => {
      const stmt = createStatementBuilder()
        .deny()
        .actions(["s3:DeleteObject"])
        .resources(["*"])
        .build();

      expect(stmt.effect).toBe(Effect.DENY);
    });
  });

  describe("wildcard guard", () => {
    it("throws WildcardResourceError for Allow with resources ['*']", () => {
      const builder = createStatementBuilder()
        .sid("TooBroad")
        .allow()
        .actions(["ec2:DescribeInstances"])
        .resources(["*"]);

      expect(() => builder.build()).toThrow(WildcardResourceError);
    });

    it("allows Allow + '*' when allowWildcardResources(true) is set", () => {
      const stmt = createStatementBuilder()
        .allow()
        .actions(["ec2:DescribeInstances"])
        .resources(["*"])
        .allowWildcardResources(true)
        .build();

      expect(stmt.resources).toEqual(["*"]);
    });

    it("does not throw for Deny with wildcard resources", () => {
      expect(() =>
        createStatementBuilder().deny().actions(["s3:*"]).resources(["*"]).build(),
      ).not.toThrow();
    });
  });

  describe("conditions", () => {
    it("passes conditions through to the PolicyStatement", () => {
      const stmt = createStatementBuilder()
        .allow()
        .actions(["s3:GetObject"])
        .resources(["arn:aws:s3:::my-bucket/*"])
        .conditions({ StringEquals: { "aws:ResourceTag/Env": "dev" } })
        .build();

      const rendered = stmt.toJSON() as { Condition: Record<string, unknown> };
      expect(rendered.Condition).toEqual({
        StringEquals: { "aws:ResourceTag/Env": "dev" },
      });
    });
  });
});
