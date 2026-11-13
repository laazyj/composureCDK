import { describe, expect, it } from "vitest";
import { Annotations as CoreAnnotations, Lazy } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";
import { buildFixture } from "@composurecdk/cdk-testing";
import { createDistributionBuilder } from "../src/distribution-builder.js";
import { LIST_BUCKET_SECURITY_RISK_WARNING_ID } from "../src/list-bucket-acknowledgement.js";

const buildAndSynth = buildFixture(createDistributionBuilder, "Cdn");

const WARNING = Match.stringLikeRegexp(LIST_BUCKET_SECURITY_RISK_WARNING_ID);

/**
 * Warns on bind exactly as `S3BucketOrigin.withOriginAccessControl()` does with
 * `AccessLevel.LIST`. A stand-in, because that origin is above this package's
 * aws-cdk-lib floor of 2.124.0 and the suite runs there too (ADR-0008).
 */
class ListOrigin extends origins.HttpOrigin {
  constructor() {
    super("example.com");
  }

  override bind(scope: Construct, options: cloudfront.OriginBindOptions) {
    CoreAnnotations.of(scope).addWarningV2(LIST_BUCKET_SECURITY_RISK_WARNING_ID, "list risk");
    return super.bind(scope, options);
  }
}

describe("list-bucket warning acknowledgement", () => {
  // Probed and typed locally: neither exists, even as a type, at this
  // package's floor, where the suite is typechecked too.
  const { S3BucketOrigin } = origins as {
    S3BucketOrigin?: {
      withOriginAccessControl(
        bucket: Bucket,
        props: { originAccessLevels: string[] },
      ): cloudfront.IOrigin;
    };
  };
  const { AccessLevel } = cloudfront as { AccessLevel?: Record<"READ" | "LIST", string> };
  const realListOrigin =
    S3BucketOrigin && AccessLevel
      ? (bucket: Bucket) =>
          S3BucketOrigin.withOriginAccessControl(bucket, {
            originAccessLevels: [AccessLevel.READ, AccessLevel.LIST],
          })
      : undefined;

  it.runIf(realListOrigin)("acknowledges CDK's own warning from an OAC origin with LIST", () => {
    const { stack } = buildAndSynth((b, s) => {
      if (realListOrigin) b.origin(realListOrigin(new Bucket(s, "Site")));
    });

    Annotations.fromStack(stack).hasNoWarning("*", WARNING);
  });

  it("acknowledges the warning when the default root object is in place", () => {
    const { stack } = buildAndSynth((b) => b.origin(new ListOrigin()));

    Annotations.fromStack(stack).hasNoWarning("*", WARNING);
  });

  it("acknowledges the warning for a LIST origin on a path behavior", () => {
    const { stack } = buildAndSynth((b) =>
      b.origin(new ListOrigin()).behavior("/assets/*", { origin: new ListOrigin() }),
    );

    Annotations.fromStack(stack).hasNoWarning("*", WARNING);
  });

  it("acknowledges the warning for a behavior added after build", () => {
    const { result, stack } = buildAndSynth((b) => b.origin(new ListOrigin()));
    result.distribution.addBehavior("/late/*", new ListOrigin());

    Annotations.fromStack(stack).hasNoWarning("*", WARNING);
  });

  it.each([
    ["removed", undefined],
    ["empty", ""],
    ["an unresolved token", Lazy.string({ produce: () => "" })],
  ])("keeps the warning when the default root object is %s", (_, rootObject) => {
    const { stack } = buildAndSynth((b) =>
      b.origin(new ListOrigin()).defaultRootObject(rootObject),
    );

    Annotations.fromStack(stack).hasWarning("*", WARNING);
  });

  it("does not acknowledge the warning for another distribution in the stack", () => {
    const { stack } = buildAndSynth((b) => b.origin(new ListOrigin()));
    createDistributionBuilder()
      .origin(new ListOrigin())
      .defaultRootObject(undefined)
      .build(stack, "OtherCdn");

    const paths = Annotations.fromStack(stack)
      .findWarning("*", WARNING)
      .map((w) => w.id);
    expect(paths).toEqual(["/TestStack/OtherCdn/Origin1"]);
  });
});
