import { describe, expect, it } from "vitest";
import { App, Lazy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as iam from "aws-cdk-lib/aws-iam";
import { OpenIdConnectProvider } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { createRoleBuilder } from "../src/role-builder.js";
import {
  oidcClaim,
  openIdConnectPrincipal,
  type OpenIdConnectPrincipalOptions,
} from "../src/open-id-connect-principal.js";

// OidcProviderNative postdates this package's aws-cdk-lib floor, so probe for it
// rather than import it, and describe it structurally: the floor's suite both
// typechecks and runs against a CDK that has no such export.
type ProviderConstructor = new (
  scope: Construct,
  id: string,
  props: { url: string; clientIds?: string[] },
) => OpenIdConnectPrincipalOptions["provider"];
const OidcProviderNative = (iam as Record<string, unknown>).OidcProviderNative as
  ProviderConstructor | undefined;

const PROVIDER_ARN = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com";
const ISSUER_HOST = "token.actions.githubusercontent.com";

function trustPolicyOf(
  configure: (stack: Stack, provider: OpenIdConnectProvider) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const provider = OpenIdConnectProvider.fromOpenIdConnectProviderArn(
    stack,
    "Provider",
    PROVIDER_ARN,
  ) as OpenIdConnectProvider;
  configure(stack, provider);
  return Template.fromStack(stack);
}

describe("openIdConnectPrincipal", () => {
  it("federates the role trust policy with sts:AssumeRoleWithWebIdentity", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(openIdConnectPrincipal({ provider, issuerHost: ISSUER_HOST }))
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: "sts:AssumeRoleWithWebIdentity",
            Principal: { Federated: PROVIDER_ARN },
          }),
        ]),
      }),
    });
  });

  it("prefixes every claim key with the issuer host and maps to the chosen operator", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            stringEquals: { aud: "sts.amazonaws.com" },
            stringLike: { sub: ["repo:acme/app:ref:refs/heads/main"] },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
              StringLike: {
                "token.actions.githubusercontent.com:sub": ["repo:acme/app:ref:refs/heads/main"],
              },
            },
          }),
        ]),
      }),
    });
  });

  it("passes keys that already contain a colon through unprefixed", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            stringEquals: {
              aud: "sts.amazonaws.com",
              "sts:RoleSessionName": `\${${ISSUER_HOST}:sub}`,
            },
            stringLike: {
              [`${ISSUER_HOST}:sub`]: ["repo:acme/app:*"],
              "aws:RequestTag/team": "platform-*",
            },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "sts:RoleSessionName": "${token.actions.githubusercontent.com:sub}",
              },
              StringLike: {
                "token.actions.githubusercontent.com:sub": ["repo:acme/app:*"],
                "aws:RequestTag/team": "platform-*",
              },
            },
          }),
        ]),
      }),
    });
  });

  it("omits condition operators that are not supplied", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            stringLike: { sub: ["repo:acme/app:pull_request"] },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                "token.actions.githubusercontent.com:sub": ["repo:acme/app:pull_request"],
              },
            }),
          }),
        ]),
      }),
    });
  });

  it("qualifies keys under any operator given in conditions", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            conditions: {
              "ForAnyValue:StringLike": { amr: "mfa" },
              StringNotLike: { sub: "repo:acme/app:pull_request" },
              "ForAllValues:StringEquals": { "aws:TagKeys": ["team"] },
            },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              "ForAnyValue:StringLike": { "token.actions.githubusercontent.com:amr": "mfa" },
              StringNotLike: {
                "token.actions.githubusercontent.com:sub": "repo:acme/app:pull_request",
              },
              "ForAllValues:StringEquals": { "aws:TagKeys": ["team"] },
            },
          }),
        ]),
      }),
    });
  });

  it("merges a shorthand operator with the same operator in conditions", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            stringEquals: { aud: "sts.amazonaws.com" },
            conditions: {
              StringEquals: {
                [`${ISSUER_HOST}:aud`]: "sts.amazonaws.com",
                repository_owner: "acme",
              },
            },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:repository_owner": "acme",
              },
            },
          }),
        ]),
      }),
    });
  });

  it("throws when one key is given different values under the same operator", () => {
    trustPolicyOf((_stack, provider) => {
      expect(() =>
        openIdConnectPrincipal({
          provider,
          issuerHost: ISSUER_HOST,
          stringLike: { sub: "repo:acme/app:*" },
          conditions: { StringLike: { [`${ISSUER_HOST}:sub`]: "repo:acme/*" } },
        }),
      ).toThrow(/"token\.actions\.githubusercontent\.com:sub" is given two different values/);
    });
  });

  it("does not treat a value and the same value as a one-item or reordered list as a conflict", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            stringEquals: { aud: "sts.amazonaws.com", repository_owner: ["acme", "corp"] },
            conditions: {
              StringEquals: { aud: ["sts.amazonaws.com"], repository_owner: ["corp", "acme"] },
            },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:repository_owner": ["acme", "corp"],
              },
            },
          }),
        ]),
      }),
    });
  });

  it("still throws when the value sets differ", () => {
    trustPolicyOf((_stack, provider) => {
      expect(() =>
        openIdConnectPrincipal({
          provider,
          issuerHost: ISSUER_HOST,
          stringEquals: { repository_owner: ["acme", "corp"] },
          conditions: { StringEquals: { repository_owner: "acme" } },
        }),
      ).toThrow(/given two different values/);
    });
  });

  it("renders oidcClaim values as issuer-qualified policy variables", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            conditions: {
              StringEquals: { "sts:RoleSessionName": oidcClaim("sub") },
              StringLike: { "aws:RequestTag/actor": [oidcClaim(`${ISSUER_HOST}:actor`), "bot-*"] },
            },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: {
                "sts:RoleSessionName": "${token.actions.githubusercontent.com:sub}",
              },
              StringLike: {
                "aws:RequestTag/actor": ["${token.actions.githubusercontent.com:actor}", "bot-*"],
              },
            },
          }),
        ]),
      }),
    });
  });

  it("compares oidcClaim values after rendering them", () => {
    trustPolicyOf((_stack, provider) => {
      expect(() =>
        openIdConnectPrincipal({
          provider,
          issuerHost: ISSUER_HOST,
          stringEquals: { "sts:RoleSessionName": oidcClaim("sub") },
          conditions: {
            StringEquals: { "sts:RoleSessionName": `\${${ISSUER_HOST}:sub}` },
          },
        }),
      ).not.toThrow();
    });
  });

  it.each(["", "${sub}", "s}ub"])("oidcClaim rejects the malformed claim %j", (claim) => {
    expect(() => oidcClaim(claim)).toThrow(/claim must be a non-empty name/);
  });

  it("rejects a hand-built claim object that did not come from oidcClaim", () => {
    trustPolicyOf((_stack, provider) => {
      expect(() =>
        openIdConnectPrincipal({
          provider,
          issuerHost: ISSUER_HOST,
          stringEquals: { "sts:RoleSessionName": { claim: "sub" } },
        }),
      ).toThrow(/must be a string or come from oidcClaim/);
    });
  });

  it.runIf(OidcProviderNative)("accepts an OidcProviderNative provider", () => {
    const stack = new Stack(new App(), "TestStack");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by runIf
    const provider = new OidcProviderNative!(stack, "Provider", {
      url: `https://${ISSUER_HOST}`,
      clientIds: ["sts.amazonaws.com"],
    });
    createRoleBuilder()
      .assumedBy(
        openIdConnectPrincipal({
          provider,
          issuerHost: ISSUER_HOST,
          stringEquals: { aud: "sts.amazonaws.com" },
        }),
      )
      .build(stack, "Role");

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::OIDCProvider", 1);
    template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Federated: { Ref: Match.stringLikeRegexp("^Provider") } },
          }),
        ]),
      }),
    });
  });

  it.each([
    "https://oidc.example.com",
    "oidc.example.com/",
    "/oidc.example.com",
    "oidc.example.com ",
    "oidc.example.com//id/x",
    "",
  ])("rejects the issuerHost %j", (issuerHost) => {
    trustPolicyOf((_stack, provider) => {
      expect(() => openIdConnectPrincipal({ provider, issuerHost })).toThrow(
        /openIdConnectPrincipal issuerHost ".*" is invalid/,
      );
    });
  });

  it("keeps an issuer path in the key prefix", () => {
    const issuerHost = "oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE";
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost,
            stringEquals: { aud: "sts.amazonaws.com" },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: { StringEquals: { [`${issuerHost}:aud`]: "sts.amazonaws.com" } },
          }),
        ]),
      }),
    });
  });

  it("does not check an issuerHost that is an unresolved token", () => {
    trustPolicyOf((_stack, provider) => {
      const issuerHost = Lazy.string({ produce: () => "oidc.example.com" });
      expect(() =>
        openIdConnectPrincipal({ provider, issuerHost, stringEquals: { aud: "x" } }),
      ).not.toThrow();
    });
  });

  it.each(["ForAnyValue:StringEquals", "StringNotEqualsIfExists", "ArnLike"] as const)(
    "accepts oidcClaim under %s",
    (operator) => {
      trustPolicyOf((_stack, provider) => {
        expect(() =>
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            conditions: { [operator]: { "aws:PrincipalTag/sub": oidcClaim("sub") } },
          }),
        ).not.toThrow();
      });
    },
  );

  it.each(["NumericEquals", "DateLessThan", "Bool", "ForAllValues:IpAddress", "Null"] as const)(
    "rejects oidcClaim under %s",
    (operator) => {
      trustPolicyOf((_stack, provider) => {
        expect(() =>
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            conditions: { [operator]: { "aws:SomeKey": ["1", oidcClaim("sub")] } },
          }),
        ).toThrow(
          /oidcClaim\("sub"\) under .* for "aws:SomeKey": IAM substitutes policy variables/,
        );
      });
    },
  );
});
