import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { EXAMPLE_CONTEXT, exampleApp } from "../src/app-context.js";
import { createMultiStackApp } from "../src/multi-stack-app.js";

/**
 * `cdk.json` and {@link EXAMPLE_CONTEXT} are two copies of the same decision:
 * the CLI reads the first, the tests synthesise with the second. CDK applies
 * CLI context *after* `App`'s `context` prop, so a divergence would not fail
 * anywhere on its own — the tests would simply assert a template CI never
 * deploys.
 */
describe("example app context", () => {
  const cdkJson = JSON.parse(readFileSync(new URL("../cdk.json", import.meta.url), "utf8")) as {
    context?: Record<string, unknown>;
  };

  it("matches the context declared in cdk.json", () => {
    expect(cdkJson.context).toEqual(EXAMPLE_CONTEXT);
  });

  it("applies the context to the apps it creates", () => {
    for (const [key, value] of Object.entries(EXAMPLE_CONTEXT)) {
      expect(exampleApp().node.tryGetContext(key)).toEqual(value);
    }
  });

  it("lets a caller override an entry", () => {
    const app = exampleApp({ context: { "@aws-cdk/core:defaultCrossStackReferences": "strong" } });

    expect(app.node.tryGetContext("@aws-cdk/core:defaultCrossStackReferences")).toBe("strong");
  });
});

/** The annotation id CDK tags its unconfigured-strength warning with (issue #341). */
const STRENGTH_UNSET_WARNING = "@aws-cdk/core:crossStackReferencesDefaultStrong";

function warningsFor(app: App, stackName: string): string {
  return app
    .synth()
    .getStackByName(stackName)
    .messages.map(({ entry }) => entry.data)
    .filter((data) => typeof data === "string")
    .join("\n");
}

/**
 * The multi-stack example is the only one that references across stacks, so it
 * is the one that shows the flag working — and the one that would surface a
 * regression if the context ever stopped reaching a synthesising app.
 */
describe("cross-stack reference strength", () => {
  it("resolves the multi-stack example's references weakly", () => {
    const { apiStack } = createMultiStackApp();
    const template = JSON.stringify(Template.fromStack(apiStack).toJSON());

    expect(template).toContain("Fn::GetStackOutput");
    expect(template).not.toContain("Fn::ImportValue");
  });

  it("synthesises without the unconfigured-strength warning", () => {
    const { apiStack } = createMultiStackApp();

    expect(warningsFor(App.of(apiStack) as App, apiStack.stackName)).not.toContain(
      STRENGTH_UNSET_WARNING,
    );
  });

  it("still warns when an app is built without the context", () => {
    const { apiStack } = createMultiStackApp(new App());

    expect(warningsFor(App.of(apiStack) as App, apiStack.stackName)).toContain(
      STRENGTH_UNSET_WARNING,
    );
  });
});
