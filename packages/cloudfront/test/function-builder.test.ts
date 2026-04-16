import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  FunctionCode,
  FunctionRuntime,
  KeyValueStore,
  ImportSource,
} from "aws-cdk-lib/aws-cloudfront";
import { createFunctionBuilder } from "../src/function-builder.js";

const INLINE_CODE = `
  async function handler(event) {
    return event.request;
  }
`;

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createFunctionBuilder>, stack: Stack) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createFunctionBuilder();
  configureFn(builder, stack);
  builder.build(stack, "TestFunction");
  return Template.fromStack(stack);
}

describe("FunctionBuilder", () => {
  describe("build", () => {
    it("returns a FunctionBuilderResult with a function property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createFunctionBuilder()
        .code(FunctionCode.fromInline(INLINE_CODE))
        .build(stack, "TestFunction");

      expect(result).toBeDefined();
      expect(result.function).toBeDefined();
    });

    it("throws when no code is provided", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createFunctionBuilder();

      expect(() => builder.build(stack, "TestFunction")).toThrow(/requires code/);
    });
  });

  describe("synthesised output", () => {
    it("creates a CloudFront Function", () => {
      const template = synthTemplate((b) => b.code(FunctionCode.fromInline(INLINE_CODE)));
      template.resourceCountIs("AWS::CloudFront::Function", 1);
    });

    it("applies the provided inline code", () => {
      const template = synthTemplate((b) => b.code(FunctionCode.fromInline(INLINE_CODE)));

      template.hasResourceProperties("AWS::CloudFront::Function", {
        FunctionCode: Match.stringLikeRegexp("handler"),
      });
    });

    it("applies a provided comment", () => {
      const template = synthTemplate((b) =>
        b.code(FunctionCode.fromInline(INLINE_CODE)).comment("URI rewrite for SPA"),
      );

      template.hasResourceProperties("AWS::CloudFront::Function", {
        FunctionConfig: Match.objectLike({
          Comment: "URI rewrite for SPA",
        }),
      });
    });

    it("applies a provided functionName", () => {
      const template = synthTemplate((b) =>
        b.code(FunctionCode.fromInline(INLINE_CODE)).functionName("MyRewriteFn"),
      );

      template.hasResourceProperties("AWS::CloudFront::Function", {
        Name: "MyRewriteFn",
      });
    });
  });

  describe("secure defaults", () => {
    it("uses the cloudfront-js-2.0 runtime by default", () => {
      const template = synthTemplate((b) => b.code(FunctionCode.fromInline(INLINE_CODE)));

      template.hasResourceProperties("AWS::CloudFront::Function", {
        FunctionConfig: Match.objectLike({
          Runtime: "cloudfront-js-2.0",
        }),
      });
    });

    it("allows the user to override the runtime", () => {
      const template = synthTemplate((b) =>
        b.code(FunctionCode.fromInline(INLINE_CODE)).runtime(FunctionRuntime.JS_1_0),
      );

      template.hasResourceProperties("AWS::CloudFront::Function", {
        FunctionConfig: Match.objectLike({
          Runtime: "cloudfront-js-1.0",
        }),
      });
    });
  });

  describe("keyValueStore pass-through", () => {
    it("associates the provided KVS with the function", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const kvs = new KeyValueStore(stack, "Kvs", {
        source: ImportSource.fromInline(JSON.stringify({ data: [{ key: "a", value: "b" }] })),
      });

      createFunctionBuilder()
        .code(FunctionCode.fromInline(INLINE_CODE))
        .keyValueStore(kvs)
        .build(stack, "TestFunction");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::CloudFront::Function", {
        FunctionConfig: Match.objectLike({
          Runtime: "cloudfront-js-2.0",
          KeyValueStoreAssociations: Match.arrayWith([
            Match.objectLike({ KeyValueStoreARN: Match.anyValue() }),
          ]),
        }),
      });
    });
  });
});
