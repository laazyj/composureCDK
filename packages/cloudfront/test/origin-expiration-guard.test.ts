import { describe, it, expect } from "vitest";
import { Annotations as CdkAnnotations, App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Bucket, type LifecycleRule } from "aws-cdk-lib/aws-s3";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { createDistributionBuilder } from "../src/distribution-builder.js";
import { ORIGIN_OBJECT_EXPIRATION_WARNING_ID } from "../src/origin-expiration-guard.js";

/**
 * The guard's stable ack id. Every assertion scopes to it so an unrelated
 * warning cannot mask a false pass — and so the silence assertions do not
 * accidentally pass because some *other* warning was the only one emitted.
 */
const ACK = "origin-object-expiration";

const expectSilent = (stack: Stack): void => {
  expect(Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp(ACK))).toEqual([]);
};

const expectWarns = (stack: Stack, message: string): void => {
  Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp(message));
};

/** Builds a distribution over an OAC-backed bucket carrying `rules`. */
function synthWithOriginRules(rules: LifecycleRule[]): Stack {
  const stack = new Stack(new App(), "TestStack");
  const bucket = new Bucket(stack, "Site", { versioned: true, lifecycleRules: rules });
  createDistributionBuilder()
    .origin(S3BucketOrigin.withOriginAccessControl(bucket))
    .build(stack, "Cdn");
  return stack;
}

describe("origin object-expiration relationship guard", () => {
  describe("warns", () => {
    it("when the origin bucket expires current versions bucket-wide", () => {
      const stack = synthWithOriginRules([{ id: "Nightly", expiration: Duration.days(90) }]);

      expectWarns(stack, "Nightly");
      expectWarns(stack, "expires current object versions across the whole bucket");
    });

    it("when the rule sets an absolute expirationDate rather than an age", () => {
      const stack = synthWithOriginRules([{ expirationDate: new Date("2030-01-01") }]);

      expectWarns(stack, ACK);
    });

    /** Rules need no id, so the message falls back to naming the expiry itself. */
    it("naming an unnamed rule by the expiry it sets", () => {
      const stack = synthWithOriginRules([{ expiration: Duration.days(90) }]);

      expectWarns(stack, "expiration after 90 days");
    });

    it("naming the offending bucket, so the fix site is unambiguous", () => {
      const stack = synthWithOriginRules([{ id: "Nightly", expiration: Duration.days(90) }]);

      expectWarns(stack, "TestStack/Site");
    });

    /**
     * The origin need not be wired through `S3BucketOrigin`: a bucket reached as
     * a custom origin still renders `Fn::GetAtt` on its domain name, and its
     * content is just as reachable by the expiry rule.
     */
    it("when the bucket is wired as a custom origin rather than through OAC", () => {
      const stack = new Stack(new App(), "TestStack");
      const bucket = new Bucket(stack, "Site", {
        lifecycleRules: [{ id: "Nightly", expiration: Duration.days(90) }],
      });
      createDistributionBuilder()
        .origin(new HttpOrigin(bucket.bucketRegionalDomainName))
        .build(stack, "Cdn");

      expectWarns(stack, "Nightly");
    });
  });

  describe("stays silent", () => {
    /**
     * The load-bearing case: the builder auto-creates an access-logs bucket that
     * *does* carry a 2-year `expiration`. It is a log sink, never an origin, so
     * a guard that matched on rule shape alone would warn on every distribution
     * the library builds.
     */
    it("for the distribution's own access-logs bucket", () => {
      const stack = new Stack(new App(), "TestStack");
      const bucket = new Bucket(stack, "Site");
      createDistributionBuilder()
        .origin(S3BucketOrigin.withOriginAccessControl(bucket))
        .build(stack, "Cdn");

      expectSilent(stack);
    });

    it("for the bucket defaults, which expire only noncurrent versions", () => {
      expectSilent(synthWithOriginRules([{ noncurrentVersionExpiration: Duration.days(30) }]));
    });

    it("for a rule scoped to a prefix", () => {
      expectSilent(synthWithOriginRules([{ prefix: "tmp/", expiration: Duration.days(7) }]));
    });

    it("for a rule scoped to an object tag", () => {
      expectSilent(
        synthWithOriginRules([{ tagFilters: { ephemeral: "true" }, expiration: Duration.days(7) }]),
      );
    });

    it("for a rule scoped by object size", () => {
      expectSilent(
        synthWithOriginRules([{ objectSizeGreaterThan: 1024, expiration: Duration.days(7) }]),
      );
    });

    it("for a disabled rule", () => {
      expectSilent(synthWithOriginRules([{ enabled: false, expiration: Duration.days(90) }]));
    });

    it("for rules that never delete a current version", () => {
      expectSilent(
        synthWithOriginRules([
          { abortIncompleteMultipartUploadAfter: Duration.days(7) },
          { expiredObjectDeleteMarker: true },
        ]),
      );
    });

    it("for a bucket with no lifecycle rules at all", () => {
      expectSilent(synthWithOriginRules([]));
    });

    /** Imported buckets have no L1 in the tree, so the rules are unknowable. */
    it("for an imported origin bucket", () => {
      const stack = new Stack(new App(), "TestStack");
      const bucket = Bucket.fromBucketName(stack, "Site", "already-exists");
      createDistributionBuilder()
        .origin(S3BucketOrigin.withOriginAccessControl(bucket))
        .build(stack, "Cdn");

      expectSilent(stack);
    });

    it("for an origin that is not a bucket", () => {
      const stack = new Stack(new App(), "TestStack");
      createDistributionBuilder().origin(new HttpOrigin("example.com")).build(stack, "Cdn");

      expectSilent(stack);
    });

    /**
     * A same-shaped rule on an unrelated bucket must not warn: the guard matches
     * the origin's logical id, not merely "some bucket in this stack".
     */
    it("for an expiry on a bucket that is not the origin", () => {
      const stack = new Stack(new App(), "TestStack");
      const origin = new Bucket(stack, "Site");
      new Bucket(stack, "Scratch", {
        lifecycleRules: [{ id: "Nightly", expiration: Duration.days(90) }],
      });
      createDistributionBuilder()
        .origin(S3BucketOrigin.withOriginAccessControl(origin))
        .build(stack, "Cdn");

      expectSilent(stack);
    });
  });

  /**
   * The ack must be registered on an ancestor scope, not on the distribution
   * itself: CDK's `Acknowledgements.searchPaths` walks the annotated node's
   * ancestor prefixes and never includes its own path, so an ack placed on the
   * warned construct is not found. Acknowledging at stack or app scope — which
   * is how a caller would reach for it anyway — works.
   */
  it("is suppressible at stack scope by its exported id", () => {
    const stack = new Stack(new App(), "TestStack");
    const bucket = new Bucket(stack, "Site", {
      lifecycleRules: [{ id: "Nightly", expiration: Duration.days(90) }],
    });
    CdkAnnotations.of(stack).acknowledgeWarning(ORIGIN_OBJECT_EXPIRATION_WARNING_ID);
    createDistributionBuilder()
      .origin(S3BucketOrigin.withOriginAccessControl(bucket))
      .build(stack, "Cdn");

    expectSilent(stack);
  });
});
