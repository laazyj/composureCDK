import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { ref, resolve } from "@composurecdk/core";
import { inlineSpecDefinition, substituteSpec } from "../src/inline-spec-definition.js";

const FUNCTION_ARN = "arn:aws:lambda:us-east-1:123456789012:function:Handler";
const ROLE_ARN = "arn:aws:iam::123456789012:role/GatewayRole";

/** A spec naming its backend by placeholder, the way an export would. */
function specWithPlaceholders() {
  return {
    openapi: "3.0.2",
    info: { title: "TestApi", version: "1.0" },
    paths: {
      "/pets": {
        get: {
          responses: { "200": { description: "OK" } },
          "x-amazon-apigateway-integration": {
            type: "aws_proxy",
            uri: "functions/${Handler.Arn}/invocations",
            credentials: "${GatewayRole.Arn}",
          },
        },
      },
    },
  };
}

/** The integration block of a substituted spec. */
function integrationOf(spec: object) {
  return (
    spec as {
      paths: Record<
        string,
        { get: { "x-amazon-apigateway-integration": { uri: string; credentials: string } } }
      >;
    }
  ).paths["/pets"].get["x-amazon-apigateway-integration"];
}

describe("substituteSpec", () => {
  it("replaces every placeholder with its value", () => {
    const integration = integrationOf(
      substituteSpec(specWithPlaceholders(), {
        "${Handler.Arn}": FUNCTION_ARN,
        "${GatewayRole.Arn}": ROLE_ARN,
      }),
    );

    expect(integration.uri).toBe(`functions/${FUNCTION_ARN}/invocations`);
    expect(integration.credentials).toBe(ROLE_ARN);
  });

  it("imposes no placeholder syntax", () => {
    const integration = integrationOf(
      substituteSpec(
        {
          paths: {
            "/pets": {
              get: {
                "x-amazon-apigateway-integration": { uri: "__HANDLER__", credentials: "{{role}}" },
              },
            },
          },
        },
        { __HANDLER__: FUNCTION_ARN, "{{role}}": ROLE_ARN },
      ),
    );

    expect(integration.uri).toBe(FUNCTION_ARN);
    expect(integration.credentials).toBe(ROLE_ARN);
  });

  it("does not let one placeholder destroy another it prefixes", () => {
    const integration = integrationOf(
      substituteSpec(
        {
          paths: {
            "/pets": {
              get: {
                "x-amazon-apigateway-integration": {
                  uri: "__HANDLER__",
                  credentials: "__HANDLER___ROLE__",
                },
              },
            },
          },
        },
        // Declared shortest-first: a sequential replace would consume the
        // prefix of the longer key and then report it as missing.
        { __HANDLER__: FUNCTION_ARN, __HANDLER___ROLE__: ROLE_ARN },
      ),
    );

    expect(integration.uri).toBe(FUNCTION_ARN);
    expect(integration.credentials).toBe(ROLE_ARN);
  });

  it("returns a copy when there is nothing to substitute", () => {
    const original = specWithPlaceholders();

    const copy = substituteSpec(original, {});

    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
  });

  it("leaves the caller's specification untouched", () => {
    const original = specWithPlaceholders();

    substituteSpec(original, { "${Handler.Arn}": FUNCTION_ARN });

    expect(original.paths["/pets"].get["x-amazon-apigateway-integration"].uri).toContain(
      "${Handler.Arn}",
    );
  });

  it("throws when a placeholder appears nowhere in the specification", () => {
    expect(() => substituteSpec(specWithPlaceholders(), { "${Absent.Arn}": FUNCTION_ARN })).toThrow(
      /"\$\{Absent\.Arn\}" appears nowhere in the specification/,
    );
  });

  it("names every placeholder that appears nowhere in the specification", () => {
    expect(() =>
      substituteSpec(specWithPlaceholders(), {
        "${Handler.Arn}": FUNCTION_ARN,
        "${One.Arn}": FUNCTION_ARN,
        "${Two.Arn}": FUNCTION_ARN,
      }),
    ).toThrow(/"\$\{One\.Arn\}", "\$\{Two\.Arn\}" appear nowhere in the specification/);
  });

  it("treats a value with JSON-significant characters as text", () => {
    const integration = integrationOf(
      substituteSpec(specWithPlaceholders(), {
        "${Handler.Arn}": 'a"quote\\and-backslash',
        "${GatewayRole.Arn}": ROLE_ARN,
      }),
    );

    expect(integration.uri).toBe('functions/a"quote\\and-backslash/invocations');
  });
});

describe("inlineSpecDefinition", () => {
  it("resolves each placeholder's ref against the build context", () => {
    const definition = inlineSpecDefinition(specWithPlaceholders(), {
      "${Handler.Arn}": ref("handler", (r: { functionArn: string }) => r.functionArn),
      "${GatewayRole.Arn}": ref("gatewayRole", (r: { roleArn: string }) => r.roleArn),
    });

    const stack = new Stack(new App(), "TestStack");
    const bound = resolve(definition, {
      handler: { functionArn: FUNCTION_ARN },
      gatewayRole: { roleArn: ROLE_ARN },
    }).bind(stack);

    const integration = integrationOf(bound.inlineDefinition as object);
    expect(integration.uri).toBe(`functions/${FUNCTION_ARN}/invocations`);
    expect(integration.credentials).toBe(ROLE_ARN);
  });

  it("accepts concrete values alongside refs", () => {
    const definition = inlineSpecDefinition(specWithPlaceholders(), {
      "${Handler.Arn}": ref("handler", (r: { functionArn: string }) => r.functionArn),
      "${GatewayRole.Arn}": ROLE_ARN,
    });

    const stack = new Stack(new App(), "TestStack");
    const bound = resolve(definition, { handler: { functionArn: FUNCTION_ARN } }).bind(stack);

    expect(integrationOf(bound.inlineDefinition as object).credentials).toBe(ROLE_ARN);
  });
});
