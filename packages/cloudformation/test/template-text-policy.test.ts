import { describe, it, expect, vi } from "vitest";
import {
  Annotations as CdkAnnotations,
  App,
  CfnOutput,
  CfnParameter,
  CfnResource,
  Fn,
  Lazy,
  Stack,
} from "aws-cdk-lib";
import { Alarm, Metric } from "aws-cdk-lib/aws-cloudwatch";
import { CfnFunction } from "aws-cdk-lib/aws-cloudfront";
import type { IConstruct } from "constructs";
import { Template } from "aws-cdk-lib/assertions";
import {
  TEMPLATE_TEXT_WARNING_NAME,
  templateTextPolicy,
  type TemplateTextPolicyConfig,
} from "../src/policies/template-text-policy.js";

const DIRTY = "low — baseline";
const CLEAN = "low - baseline";

function alarm(scope: Stack, id: string, description: string): Alarm {
  return new Alarm(scope, id, {
    metric: new Metric({ namespace: "Test", metricName: "Errors" }),
    threshold: 1,
    evaluationPeriods: 1,
    alarmDescription: description,
  });
}

/**
 * A CloudFront Function carrying `text` in one of its two free-text positions:
 * a comment in the inline source, which the registry reaches, or the nested
 * `FunctionConfig.Comment`, which it does not.
 */
function cloudFrontFunction(scope: Stack, id: string, where: "code" | "comment", text: string) {
  return new CfnFunction(scope, id, {
    name: id,
    functionCode: `function handler(event) { /* ${where === "code" ? text : id} */ return event.request; }`,
    functionConfig: { comment: where === "comment" ? text : id, runtime: "cloudfront-js-1.0" },
  });
}

/**
 * Warnings recorded anywhere under `node`, read from construct metadata rather
 * than `aws-cdk-lib/assertions`' `Annotations`. That helper — and
 * `Match.stringLikeRegexp` — postdate this package's declared aws-cdk-lib floor
 * of 2.1.0, and the floor guard typechecks the suite against it (ADR-0008).
 */
function warnings(node: IConstruct): { path: string; message: string }[] {
  const here = node.node.metadata
    .filter((entry) => entry.type === "aws:cdk:warning")
    .map((entry) => ({ path: node.node.path, message: String(entry.data) }));
  return [here, ...node.node.children.map(warnings)].flat();
}

/** A one-stack app; pass a description to put non-ASCII on the stack itself. */
function tree(description?: string) {
  const app = new App();
  const stack = new Stack(app, "TestStack", description === undefined ? {} : { description });
  return { app, stack };
}

/** The common case: non-ASCII on both the stack description and an alarm. */
function dirtyTree(config: TemplateTextPolicyConfig = {}) {
  const { app, stack } = tree(DIRTY);
  alarm(stack, "Alarm", DIRTY);
  templateTextPolicy(app, config);
  return { app, stack };
}

describe("templateTextPolicy — throw mode", () => {
  it("fails synth on a stack description", () => {
    const { app } = dirtyTree();
    expect(() => app.synth()).toThrow("U+2014");
  });

  it("names the construct path and the field", () => {
    const { app, stack } = tree();
    alarm(stack, "Alarm", DIRTY);
    templateTextPolicy(app);
    expect(() => app.synth()).toThrow(
      "TestStack/Alarm/Resource: AWS::CloudWatch::Alarm alarmDescription contains",
    );
  });

  it("is the default mode", () => {
    const { app } = dirtyTree({ onViolation: "throw" });
    expect(() => app.synth()).toThrow("U+2014");
  });

  it("passes a clean tree", () => {
    const { app, stack } = tree(CLEAN);
    alarm(stack, "Alarm", CLEAN);
    templateTextPolicy(app);
    expect(() => app.synth()).not.toThrow();
  });
});

describe("templateTextPolicy — sanitize mode", () => {
  it("rewrites the value so the template matches what CloudFormation stores", () => {
    const { app, stack } = dirtyTree({ onViolation: "sanitize" });
    app.synth();
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: CLEAN,
    });
  });

  it("rewrites the stack description", () => {
    const { app, stack } = dirtyTree({ onViolation: "sanitize" });
    app.synth();
    expect(stack.templateOptions.description).toBe(CLEAN);
  });

  it("rewrites a CfnOutput description", () => {
    const { app, stack } = tree();
    const url = new CfnOutput(stack, "Url", { value: "https://example.com", description: DIRTY });
    templateTextPolicy(app, { onViolation: "sanitize" });
    app.synth();
    expect(url.description).toBe(CLEAN);
  });

  it("honours a custom replacement", () => {
    const { app, stack } = dirtyTree({ onViolation: "sanitize", replace: () => "~" });
    app.synth();
    expect(stack.templateOptions.description).toBe("low ~ baseline");
  });
});

describe("templateTextPolicy — warn mode", () => {
  it("reports every violation in one pass, without failing synth", () => {
    const { app, stack } = dirtyTree({ onViolation: "warn" });
    expect(() => app.synth()).not.toThrow();

    const reported = warnings(stack);
    expect(reported.map((w) => w.path)).toEqual(["TestStack", "TestStack/Alarm/Resource"]);
    expect(reported.every((w) => w.message.includes("U+2014"))).toBe(true);
  });

  it("uses an acknowledgeable warning id", () => {
    expect(TEMPLATE_TEXT_WARNING_NAME).toBe("composurecdk:templateText");
  });

  /**
   * Swaps the annotation methods on the shared prototype for the duration of
   * `run`. Both branches of the version shim have to be forced: `addWarningV2`
   * does not exist at this package's 2.1.0 floor, and the `addWarning`
   * fallback is unreachable on a current aws-cdk-lib — so whichever version
   * the suite happens to run against, one branch is dead without this.
   */
  function withAnnotationMethods(methods: Record<string, unknown>, run: () => void): void {
    const proto = CdkAnnotations.prototype as unknown as Record<string, unknown>;
    const original = { addWarningV2: proto.addWarningV2, addWarning: proto.addWarning };
    delete proto.addWarningV2;
    Object.assign(proto, methods);
    try {
      run();
    } finally {
      delete proto.addWarningV2;
      Object.assign(proto, original);
    }
  }

  it("uses addWarningV2 with the acknowledgeable id where the runtime has it", () => {
    const addWarningV2 = vi.fn();
    withAnnotationMethods({ addWarningV2 }, () => {
      const { app } = dirtyTree({ onViolation: "warn" });
      expect(() => app.synth()).not.toThrow();
      expect(addWarningV2).toHaveBeenCalledWith(
        TEMPLATE_TEXT_WARNING_NAME,
        expect.stringContaining("U+2014"),
      );
    });
  });

  it("degrades to addWarning below aws-cdk-lib 2.93.0, this package's floor being 2.1.0", () => {
    const addWarning = vi.fn();
    withAnnotationMethods({ addWarning }, () => {
      const { app } = dirtyTree({ onViolation: "warn" });
      expect(() => app.synth()).not.toThrow();
      expect(addWarning).toHaveBeenCalledWith(expect.stringContaining("U+2014"));
    });
  });
});

describe("templateTextPolicy — coverage", () => {
  it("checks CfnOutput descriptions", () => {
    const { app, stack } = tree();
    new CfnOutput(stack, "Url", { value: "https://example.com", description: DIRTY });
    templateTextPolicy(app);
    expect(() => app.synth()).toThrow("TestStack/Url: description contains");
  });

  it("checks CfnParameter descriptions", () => {
    const { app, stack } = tree();
    new CfnParameter(stack, "Stage", { type: "String", description: DIRTY });
    templateTextPolicy(app);
    expect(() => app.synth()).toThrow("TestStack/Stage: description contains");
  });

  it("checks raw L1 constructs the library never built", () => {
    const { app, stack } = tree();
    new CfnResource(stack, "Fn", {
      type: "AWS::Lambda::Function",
      properties: { Description: DIRTY },
    });
    templateTextPolicy(app);
    // A bare CfnResource carries its props in `properties`, not on a typed
    // accessor, so this documents the boundary rather than a catch.
    expect(() => app.synth()).not.toThrow();
  });

  it("checks a consumer-supplied field", () => {
    const { app, stack } = tree();
    const widget = new CfnResource(stack, "Widget", { type: "AWS::Custom::Widget" });
    (widget as unknown as Record<string, unknown>).notes = DIRTY;
    templateTextPolicy(app, { fields: { "AWS::Custom::Widget": ["notes"] } });
    expect(() => app.synth()).toThrow("AWS::Custom::Widget notes contains");
  });

  it("unions consumer fields with the built-in list for the same type", () => {
    const { app, stack } = tree();
    alarm(stack, "Alarm", DIRTY);
    templateTextPolicy(app, { fields: { "AWS::CloudWatch::Alarm": ["alarmName"] } });
    expect(() => app.synth()).toThrow("alarmDescription contains");
  });

  it("ignores resource types outside the registry", () => {
    const { app, stack } = tree();
    const bucket = new CfnResource(stack, "Bucket", { type: "AWS::S3::Bucket" });
    (bucket as unknown as Record<string, unknown>).description = DIRTY;
    templateTextPolicy(app);
    expect(() => app.synth()).not.toThrow();
  });

  it("checks a Lazy, because its resolved value is what deploys", () => {
    const { app, stack } = tree();
    alarm(stack, "Alarm", Lazy.string({ produce: () => DIRTY }));
    templateTextPolicy(app);
    expect(() => app.synth()).toThrow("U+2014");
  });

  it("skips a value that resolves to a CloudFormation intrinsic", () => {
    const { app, stack } = tree();
    alarm(stack, "Alarm", Fn.importValue("SomeExport"));
    templateTextPolicy(app);
    expect(() => app.synth()).not.toThrow();
  });

  it("checks a CloudFront Function's inline source", () => {
    const { app, stack } = tree();
    cloudFrontFunction(stack, "Redirects", "code", DIRTY);
    templateTextPolicy(app);
    expect(() => app.synth()).toThrow("AWS::CloudFront::Function functionCode contains");
  });

  it("checks a CloudFront KeyValueStore comment", () => {
    const { app, stack } = tree();
    // Stubbed rather than built from `CfnKeyValueStore`: that L1 does not exist
    // at this package's 2.1.0 floor (absent at 2.110.0, present by 2.124.0,
    // which is where @composurecdk/cloudfront floors), and the floor shard runs
    // this suite. The policy reads `cfnResourceType` then the property off the
    // instance, which is exactly what this stands in for.
    const store = new CfnResource(stack, "Redirects", {
      type: "AWS::CloudFront::KeyValueStore",
    });
    (store as unknown as Record<string, unknown>).comment = DIRTY;
    templateTextPolicy(app);
    expect(() => app.synth()).toThrow("AWS::CloudFront::KeyValueStore comment contains");
  });

  it("cannot reach a nested Comment, even on a registered type, even if asked to", () => {
    const { app, stack } = tree();
    cloudFrontFunction(stack, "Redirects", "comment", DIRTY);
    templateTextPolicy(app, {
      fields: { "AWS::CloudFront::Function": ["functionConfig.comment"] },
    });
    // `functionConfig` is object-valued, so its `Comment` sits behind a nested
    // path no property name reaches — registering the dotted path no-ops
    // rather than erroring. CloudFront is covered at `functionCode` only.
    expect(() => app.synth()).not.toThrow();
  });

  it("covers constructs added after the policy is installed", () => {
    const { app, stack } = tree();
    templateTextPolicy(app);
    alarm(stack, "Alarm", DIRTY);
    expect(() => app.synth()).toThrow("U+2014");
  });
});
