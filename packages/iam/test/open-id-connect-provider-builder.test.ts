import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createOpenIdConnectProviderBuilder } from "../src/open-id-connect-provider-builder.js";

const OIDC_RESOURCE = "Custom::AWSCDKOpenIdConnectProvider";

function build(
  configureFn?: (b: ReturnType<typeof createOpenIdConnectProviderBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createOpenIdConnectProviderBuilder().url(
    "https://token.actions.githubusercontent.com",
  );
  configureFn?.(builder);
  builder.build(stack, "TestProvider");
  return Template.fromStack(stack);
}

describe("OpenIdConnectProviderBuilder", () => {
  describe("build", () => {
    it("returns a result exposing the provider construct", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createOpenIdConnectProviderBuilder()
        .url("https://token.actions.githubusercontent.com")
        .build(stack, "TestProvider");

      expect(result.provider).toBeDefined();
      expect(result.provider.openIdConnectProviderArn).toBeDefined();
    });

    it("creates exactly one OIDC provider", () => {
      const template = build();
      template.resourceCountIs(OIDC_RESOURCE, 1);
    });

    it("passes url and clientIds through to the provider", () => {
      const template = build((b) => b.clientIds(["sts.amazonaws.com"]));
      template.hasResourceProperties(
        OIDC_RESOURCE,
        Match.objectLike({
          Url: "https://token.actions.githubusercontent.com",
          ClientIDList: ["sts.amazonaws.com"],
        }),
      );
    });

    it("throws when url is not configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createOpenIdConnectProviderBuilder();

      expect(() => builder.build(stack, "TestProvider")).toThrow(/url\(\.\.\.\) must be called/);
    });

    it("throws when url does not begin with https://", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createOpenIdConnectProviderBuilder().url("http://insecure.example.com");

      expect(() => builder.build(stack, "TestProvider")).toThrow(/must begin with "https:\/\/"/);
    });
  });
});
