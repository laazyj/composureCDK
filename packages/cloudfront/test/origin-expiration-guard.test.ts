import { describe, it, expect } from "vitest";
import { Annotations as CdkAnnotations, App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Bucket, type LifecycleRule } from "aws-cdk-lib/aws-s3";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
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

/**
 * Builds a distribution over a bucket carrying `rules`.
 *
 * The origin is wired as an `HttpOrigin` on the bucket's regional domain name
 * rather than through `S3BucketOrigin`, which is above this package's
 * aws-cdk-lib floor of 2.124.0. Nothing is lost: the guard correlates on the
 * rendered `Fn::GetAtt` that `domainName` resolves to, never on the origin
 * class, and both wirings render that reference identically. The static-website
 * example's suite covers the real `withOriginAccessControl` path, where the
 * installed CDK is not floor-pinned.
 */
function synthWithOriginRules(rules: LifecycleRule[]): Stack {
  const stack = new Stack(new App(), "TestStack");
  const bucket = new Bucket(stack, "Site", { versioned: true, lifecycleRules: rules });
  createDistributionBuilder()
    .origin(new HttpOrigin(bucket.bucketRegionalDomainName))
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
        .origin(new HttpOrigin(bucket.bucketRegionalDomainName))
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
        .origin(new HttpOrigin(bucket.bucketRegionalDomainName))
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
        .origin(new HttpOrigin(origin.bucketRegionalDomainName))
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
      .origin(new HttpOrigin(bucket.bucketRegionalDomainName))
      .build(stack, "Cdn");

    expectSilent(stack);
  });
});
