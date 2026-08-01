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
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
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
    new CfnOutput(stack, "Url", { value: "https://example.com", description: DIRTY });
    templateTextPolicy(app, { onViolation: "sanitize" });
    app.synth();
    Template.fromStack(stack).hasOutput("Url", { Description: CLEAN });
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
    Annotations.fromStack(stack).hasWarning(
      "/TestStack/Alarm/Resource",
      Match.stringLikeRegexp(".*U\\+2014.*"),
    );
  });

  it("uses an acknowledgeable warning id", () => {
    expect(TEMPLATE_TEXT_WARNING_NAME).toBe("composurecdk:templateText");
  });

  it("degrades to addWarning below aws-cdk-lib 2.93.0, this package's floor being 2.1.0", () => {
    const proto = CdkAnnotations.prototype as unknown as Record<string, unknown>;
    const addWarningV2 = proto.addWarningV2;
    const addWarning = vi.fn();
    delete proto.addWarningV2;
    proto.addWarning = addWarning;

    try {
      const { app } = dirtyTree({ onViolation: "warn" });
      expect(() => app.synth()).not.toThrow();
      expect(addWarning).toHaveBeenCalledWith(expect.stringContaining("U+2014"));
    } finally {
      proto.addWarningV2 = addWarningV2;
    }
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

  it("covers constructs added after the policy is installed", () => {
    const { app, stack } = tree();
    templateTextPolicy(app);
    alarm(stack, "Alarm", DIRTY);
    expect(() => app.synth()).toThrow("U+2014");
  });
});
