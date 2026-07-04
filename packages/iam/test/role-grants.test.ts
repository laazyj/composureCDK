import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { type IGrantable, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { compose, grantVia, type Lifecycle, ref, type Resolvable } from "@composurecdk/core";
import { createRoleBuilder } from "../src/role-builder.js";

// A read grant on a real Bucket. `grant()` is resource-agnostic, so exercising
// it against an actual construct's native `grantRead` is the faithful check —
// this is exactly what a resource package's capability helper produces.
const readBucket = (bucket: Resolvable<Bucket>) =>
  grantVia(bucket, (b: Bucket, grantee: IGrantable) => {
    b.grantRead(grantee);
  });

const lambdaRole = () =>
  createRoleBuilder().assumedBy(new ServicePrincipal("lambda.amazonaws.com"));

// The role's default policy renders as an AWS::IAM::Policy carrying the granted
// s3 read actions — its presence proves the grant reached the role.
const expectRoleHasS3ReadPolicy = (template: Template): void => {
  template.resourceCountIs("AWS::IAM::Policy", 1);
  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: Match.arrayWith([Match.stringLikeRegexp("s3:GetObject")]) }),
      ]),
    }),
  });
};

describe("RoleBuilder.grant", () => {
  it("applies a queued grant to the built role", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "Bucket");

    lambdaRole().grant(readBucket(bucket)).build(stack, "TestRole");

    expectRoleHasS3ReadPolicy(Template.fromStack(stack));
  });

  it("resolves a ref grant through compose context, edge pointing role -> resource", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");

    const store: Lifecycle<{ bucket: Bucket }> = {
      build: (scope, id) => ({ bucket: new Bucket(scope, id) }),
    };
    const role = lambdaRole().grant(
      readBucket(ref<{ bucket: Bucket }, Bucket>("store", (r) => r.bucket)),
    );

    // role depends on store (role: ["store"]) — the grant follows the data-flow
    // edge and composes without a cycle.
    expect(() =>
      compose({ store, role }, { store: [], role: ["store"] }).build(stack, "Sys"),
    ).not.toThrow();

    expectRoleHasS3ReadPolicy(Template.fromStack(stack));
  });

  it("preserves queued grants across .copy()", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "Bucket");

    const original = lambdaRole().grant(readBucket(bucket));
    original.copy().build(stack, "CopiedRole");

    // The copied role received the s3 policy → the grant survived the copy.
    expectRoleHasS3ReadPolicy(Template.fromStack(stack));
  });
});
