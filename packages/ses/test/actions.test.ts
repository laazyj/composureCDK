import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Key } from "aws-cdk-lib/aws-kms";
import { Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket, type IBucket } from "aws-cdk-lib/aws-s3";
import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  AddHeader,
  Bounce,
  BounceTemplate,
  EmailEncoding,
  Lambda,
  LambdaInvocationType,
  S3,
  Sns,
  Stop,
} from "aws-cdk-lib/aws-ses-actions";
import { ref, resolve } from "@composurecdk/core";
import {
  addHeaderAction,
  bounceAction,
  lambdaAction,
  s3Action,
  snsAction,
  stopAction,
} from "../src/actions.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack");
}

function newFn(stack: Stack, id = "Fn"): LambdaFn {
  return new LambdaFn(stack, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = () => {};"),
  });
}

describe("s3Action", () => {
  it("stores to a bucket with prefix, KMS key, and topic — granting the key", () => {
    const stack = newStack();
    const bucket = new Bucket(stack, "Bucket");
    const key = new Key(stack, "Key");
    const topic = new Topic(stack, "Topic");
    const action = resolve(
      s3Action(bucket, { objectKeyPrefix: "inbound/", kmsKey: key, topic }),
      {},
    );
    expect(action).toBeInstanceOf(S3);
    Template.fromStack(stack).hasResourceProperties(
      "AWS::KMS::Key",
      Match.objectLike({
        KeyPolicy: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Principal: { Service: "ses.amazonaws.com" } }),
          ]),
        }),
      }),
    );
  });

  it("stores to a bucket with no options", () => {
    const stack = newStack();
    const action = resolve(s3Action(new Bucket(stack, "Bucket")), {});
    expect(action).toBeInstanceOf(S3);
  });

  it("resolves a bucket passed as a ref", () => {
    const stack = newStack();
    const bucket = new Bucket(stack, "Bucket");
    const action = resolve(s3Action(ref<{ bucket: IBucket }>("b").get("bucket")), {
      b: { bucket },
    });
    expect(action).toBeInstanceOf(S3);
  });
});

describe("lambdaAction", () => {
  it("invokes a concrete function", () => {
    const stack = newStack();
    expect(resolve(lambdaAction(newFn(stack)), {})).toBeInstanceOf(Lambda);
  });

  it("wires a function by ref, with options", () => {
    const stack = newStack();
    const fn = newFn(stack);
    const action = resolve(
      lambdaAction(ref<{ function: IFunction }>("h").get("function"), {
        invocationType: LambdaInvocationType.EVENT,
        topic: new Topic(stack, "Topic"),
      }),
      { h: { function: fn } },
    );
    expect(action).toBeInstanceOf(Lambda);
  });
});

describe("snsAction", () => {
  it("publishes to a concrete topic", () => {
    const stack = newStack();
    expect(snsAction(new Topic(stack, "Topic"))).toBeInstanceOf(Sns);
  });

  it("wires a topic by ref, with encoding", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");
    const action = resolve(
      snsAction(ref<{ topic: Topic }>("t").get("topic"), { encoding: EmailEncoding.BASE64 }),
      { t: { topic } },
    );
    expect(action).toBeInstanceOf(Sns);
  });
});

describe("bounceAction", () => {
  it("bounces with a template and sender", () => {
    expect(
      bounceAction({ template: BounceTemplate.MESSAGE_CONTENT_REJECTED, sender: "mailer@x.com" }),
    ).toBeInstanceOf(Bounce);
  });

  it("bounces with a concrete notification topic", () => {
    const stack = newStack();
    expect(
      bounceAction({
        template: BounceTemplate.MAILBOX_DOES_NOT_EXIST,
        sender: "mailer@x.com",
        topic: new Topic(stack, "Topic"),
      }),
    ).toBeInstanceOf(Bounce);
  });

  it("wires a notification topic by ref", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");
    const action = resolve(
      bounceAction({
        template: BounceTemplate.TEMPORARY_FAILURE,
        sender: "mailer@x.com",
        topic: ref<{ topic: Topic }>("t").get("topic"),
      }),
      { t: { topic } },
    );
    expect(action).toBeInstanceOf(Bounce);
  });
});

describe("stopAction", () => {
  it("stops with no topic", () => {
    expect(stopAction()).toBeInstanceOf(Stop);
  });

  it("stops with a concrete topic", () => {
    const stack = newStack();
    expect(stopAction(new Topic(stack, "Topic"))).toBeInstanceOf(Stop);
  });

  it("wires a stop notification topic by ref", () => {
    const stack = newStack();
    const topic = new Topic(stack, "Topic");
    const action = resolve(stopAction(ref<{ topic: Topic }>("t").get("topic")), { t: { topic } });
    expect(action).toBeInstanceOf(Stop);
  });
});

describe("addHeaderAction", () => {
  it("adds a header", () => {
    expect(addHeaderAction("X-Env", "prod")).toBeInstanceOf(AddHeader);
  });
});
