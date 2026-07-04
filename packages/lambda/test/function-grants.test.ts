import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { type IGrantable } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, grantVia, type Lifecycle, ref, type Resolvable } from "@composurecdk/core";
import { createFunctionBuilder } from "../src/function-builder.js";

// A write grant on a real Bucket, built the same way a resource package's
// capability helper (bucketGrants.write) does — grant() is resource-agnostic,
// so exercising a real construct's native grantWrite is the faithful check.
const writeBucket = (bucket: Resolvable<Bucket>) =>
  grantVia(bucket, (b: Bucket, grantee: IGrantable) => {
    b.grantWrite(grantee);
  });

const handler = () =>
  createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async () => {};"));

// The grant lands on the function's execution role, rendered as an
// AWS::IAM::Policy carrying the s3 write actions.
const expectExecRoleHasS3WritePolicy = (template: Template): void => {
  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: Match.arrayWith([Match.stringLikeRegexp("s3:PutObject")]) }),
      ]),
    }),
  });
};

describe("FunctionBuilder.grant", () => {
  it("applies a grant to the function's execution role", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "Bucket");

    handler().grant(writeBucket(bucket)).build(stack, "Handler");

    expectExecRoleHasS3WritePolicy(Template.fromStack(stack));
  });

  it("resolves a ref grant through compose context, edge pointing handler -> resource", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");

    const store: Lifecycle<{ bucket: Bucket }> = {
      build: (scope, id) => ({ bucket: new Bucket(scope, id) }),
    };
    const fn = handler().grant(
      writeBucket(ref<{ bucket: Bucket }, Bucket>("store", (r) => r.bucket)),
    );

    // handler depends on store (handler: ["store"]) — the grant follows the
    // data-flow edge and composes without a cycle.
    expect(() =>
      compose({ store, handler: fn }, { store: [], handler: ["store"] }).build(stack, "Sys"),
    ).not.toThrow();

    expectExecRoleHasS3WritePolicy(Template.fromStack(stack));
  });

  it("preserves queued grants across .copy()", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "Bucket");

    handler().grant(writeBucket(bucket)).copy().build(stack, "CopiedHandler");

    expectExecRoleHasS3WritePolicy(Template.fromStack(stack));
  });
});
