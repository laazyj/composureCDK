import { describe, it, expect } from "vitest";
import { App, Stack, PropertyInjectors } from "aws-cdk-lib";
import type { IPropertyInjector } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Function as LambdaFunction, Runtime, Code, Tracing } from "aws-cdk-lib/aws-lambda";
import type { FunctionProps } from "aws-cdk-lib/aws-lambda";
import { compose } from "@composurecdk/core";
import { createFunctionBuilder } from "../src/function-builder.js";

function minimalFunctionBuilder() {
  return createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async () => {}"));
}

class DescriptionInjector implements IPropertyInjector {
  readonly constructUniqueId = LambdaFunction.PROPERTY_INJECTION_ID;
  inject(originalProps: FunctionProps): FunctionProps {
    return {
      ...originalProps,
      description: "injected-by-blueprint",
    };
  }
}

describe("PropertyInjector compatibility", () => {
  it("applies to Lambda constructs created inside FunctionBuilder.build()", () => {
    const app = new App();
    PropertyInjectors.of(app).add(new DescriptionInjector());
    const stack = new Stack(app, "TestStack");

    minimalFunctionBuilder().build(stack, "TestFunction");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Description: "injected-by-blueprint",
    });
  });

  it("injector sees props after ComposureCDK defaults have been merged", () => {
    const app = new App();
    let receivedTracing: unknown;

    const spyInjector: IPropertyInjector = {
      constructUniqueId: LambdaFunction.PROPERTY_INJECTION_ID,
      inject(originalProps: FunctionProps): FunctionProps {
        receivedTracing = originalProps.tracing;
        return originalProps;
      },
    };
    PropertyInjectors.of(app).add(spyInjector);
    const stack = new Stack(app, "TestStack");

    minimalFunctionBuilder().build(stack, "TestFunction");

    // The injector should see the ACTIVE tracing default from FUNCTION_DEFAULTS
    expect(receivedTracing).toBe(Tracing.ACTIVE);
  });

  it("applies through compose()", () => {
    const app = new App();
    PropertyInjectors.of(app).add(new DescriptionInjector());
    const stack = new Stack(app, "TestStack");

    const system = compose({ handler: minimalFunctionBuilder() }, { handler: [] });

    system.build(stack, "System");
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Description: "injected-by-blueprint",
    });
  });
});
